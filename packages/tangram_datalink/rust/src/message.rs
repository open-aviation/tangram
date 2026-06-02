use acars::decode::avlc::AvlcPayload;
use acars::decode::payload::arinc622::adsc::{AdscMessage, AdscTag};
use acars::decode::payload::arinc622::cpdlc::{
    CpdlcAltitude, CpdlcDegrees, CpdlcElementBody, CpdlcPduSummary, CpdlcPosition,
};
use acars::decode::payload::AcarsAppPayload;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct DatalinkKinematics {
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub altitude_ft: Option<i32>,
    pub track: Option<f64>,
    pub derived_from: Option<String>,
}

impl DatalinkKinematics {
    pub fn merge(&mut self, other: DatalinkKinematics) {
        if other.latitude.is_some() {
            self.latitude = other.latitude;
        }
        if other.longitude.is_some() {
            self.longitude = other.longitude;
        }
        if other.altitude_ft.is_some() {
            self.altitude_ft = other.altitude_ft;
        }
        if other.track.is_some() {
            self.track = other.track;
        }
        if other.derived_from.is_some() {
            self.derived_from = other.derived_from;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatalinkMessage {
    pub timestamp: f64,
    pub source_system: String,
    pub bearer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icao24: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flight_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sublabel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_protocol: Option<String>,
    #[serde(skip_serializing_if = "Value::is_null")]
    pub app_data: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kinematics: Option<DatalinkKinematics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_frame_hex: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// this is incredibly hacky and relies on lots of assumptions
// TODO think of a better way instead of stringly parsing, needs coordination
// with upstream
pub fn parse_message(json: &Value) -> Option<DatalinkMessage> {
    let mut bearer = json
        .pointer("/bearer")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    if bearer == "websocket" {
        bearer = "airframes_ws".to_string(); // TODO dont do this
    }

    let decoded = json.get("decoded").unwrap_or(json);

    let timestamp = decoded
        .pointer("/timestamp")
        .and_then(|v| v.as_f64())
        .or_else(|| {
            json.pointer("/raw/timestamp")
                .or_else(|| json.pointer("/raw/created_at"))
                .and_then(parse_timestamp)
        })?;

    let mut icao24 = json
        .pointer("/raw/from_hex")
        .or_else(|| json.pointer("/raw/icao"))
        .or_else(|| json.pointer("/raw/airframe/icao"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && !s.contains("FFFF"))
        .map(|s| s.to_uppercase());

    let reg = decoded
        .pointer("/tail")
        .or_else(|| json.pointer("/raw/tail"))
        .or_else(|| json.pointer("/raw/airframe/tail"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from);

    let flight_id = decoded
        .pointer("/flight_id")
        .or_else(|| json.pointer("/raw/flight/flight"))
        .or_else(|| json.pointer("/raw/flight_id"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().to_uppercase());

    let label = decoded
        .pointer("/label")
        .or_else(|| json.pointer("/raw/label"))
        .and_then(Value::as_str)
        .map(String::from);

    let text = decoded
        .pointer("/text")
        .or_else(|| json.pointer("/raw/text"))
        .and_then(Value::as_str)
        .map(String::from);

    let app_protocol = decoded
        .pointer("/app/protocol")
        .and_then(Value::as_str)
        .map(String::from);

    let app_data = decoded
        .pointer("/app/payload")
        .cloned()
        .unwrap_or(Value::Null);

    let mut imi = None;
    let mut kinematics = None;

    if let Some(raw_decode) = decoded.get("raw_decode") {
        if let Ok(avlc) =
            serde_json::from_value::<acars::decode::avlc::AvlcFrame>(raw_decode.clone())
        {
            if avlc.src.is_aircraft() {
                icao24 = Some(format!("{:06X}", avlc.src.icao24));
            } else if avlc.dst.is_aircraft() {
                icao24 = Some(format!("{:06X}", avlc.dst.icao24));
            }

            if let Some(payload) = &avlc.payload {
                match payload {
                    AvlcPayload::Acars(msg) => {
                        if let AcarsAppPayload::Arinc622(a) = &msg.app {
                            imi = Some(a.imi.as_str().to_string());
                        }
                        kinematics = extract_kinematics(Some(&msg.app), None);
                    }
                    AvlcPayload::X25(x25) => {
                        if let Some(acars::decode::x25::X25Inner::ClnpCompressed(clnp)) = &x25.inner
                        {
                            if let Some(acars::decode::x25::ClnpInner::Cotp(cotps)) = &clnp.inner {
                                for cotp in cotps {
                                    if let Some(atn) = &cotp.atn_cpdlc {
                                        kinematics = extract_kinematics(None, Some(atn));
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else if let Ok(msg) =
            serde_json::from_value::<acars::decode::acars::AcarsMessage>(raw_decode.clone())
        {
            if let AcarsAppPayload::Arinc622(a) = &msg.app {
                imi = Some(a.imi.as_str().to_string());
            }
            kinematics = extract_kinematics(Some(&msg.app), None);
        }
    }

    let mut base_kin = DatalinkKinematics::default();
    let mut has_base = false;

    if let Some(raw) = json.get("raw") {
        let lat = raw
            .pointer("/flight/latitude")
            .or_else(|| raw.pointer("/lat"))
            .or_else(|| raw.pointer("/latitude"))
            .and_then(|v| v.as_f64());
        let lon = raw
            .pointer("/flight/longitude")
            .or_else(|| raw.pointer("/lon"))
            .or_else(|| raw.pointer("/longitude"))
            .and_then(|v| v.as_f64());
        let alt = raw
            .pointer("/flight/altitude")
            .or_else(|| raw.pointer("/alt"))
            .or_else(|| raw.pointer("/altitude"))
            .and_then(|v| v.as_f64())
            .map(|v| v as i32);
        let trk = raw
            .pointer("/flight/track")
            .or_else(|| raw.pointer("/track"))
            .and_then(|v| v.as_f64());

        if let (Some(latitude), Some(longitude)) = (lat, lon) {
            if latitude != 0.0 && longitude != 0.0 {
                base_kin.latitude = Some(latitude);
                base_kin.longitude = Some(longitude);
                base_kin.altitude_ft = alt;
                base_kin.track = trk;
                base_kin.derived_from = Some("airframes_api".to_string());
                has_base = true;
            }
        }
    }

    if let Some(k) = kinematics {
        base_kin.merge(k);
        has_base = true;
    }

    Some(DatalinkMessage {
        timestamp,
        source_system: json
            .pointer("/source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        bearer,
        icao24,
        registration: reg,
        flight_id,
        label,
        sublabel: None,
        imi,
        text,
        app_protocol,
        app_data,
        kinematics: if has_base { Some(base_kin) } else { None },
        raw_frame_hex: json
            .pointer("/frame")
            .and_then(|v| v.as_str())
            .map(String::from),
        error: None,
    })
}

fn parse_timestamp(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => DateTime::parse_from_rfc3339(s)
            .map(|dt| dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_micros()) / 1_000_000.0)
            .ok(),
        _ => None,
    }
}

pub fn extract_kinematics(
    app: Option<&AcarsAppPayload>,
    atn: Option<&CpdlcPduSummary>,
) -> Option<DatalinkKinematics> {
    if let Some(app) = app {
        match app {
            AcarsAppPayload::Arinc622(msg) => match &msg.payload {
                acars::decode::payload::arinc622::Payload::Adsc(adsc) => {
                    return extract_adsc_position(adsc);
                }
                acars::decode::payload::arinc622::Payload::Cpdlc(cpdlc) => {
                    return extract_cpdlc_position(
                        cpdlc
                            .downlink
                            .as_ref()
                            .into_iter()
                            .chain(cpdlc.uplink.as_ref()),
                    );
                }
                _ => {}
            },
            AcarsAppPayload::AocPosition(pos) => {
                let (Some(latitude), Some(longitude)) = (pos.latitude, pos.longitude) else {
                    return None;
                };
                return Some(DatalinkKinematics {
                    latitude: Some(latitude),
                    longitude: Some(longitude),
                    altitude_ft: pos.altitude_ft,
                    track: pos.heading_deg.map(|h| h as f64),
                    derived_from: Some(format!("aoc_{}", pos.format)),
                });
            }
            AcarsAppPayload::Label32(pos) => {
                let (Some(latitude), Some(longitude)) = (pos.latitude, pos.longitude) else {
                    return None;
                };
                return Some(DatalinkKinematics {
                    latitude: Some(latitude),
                    longitude: Some(longitude),
                    altitude_ft: pos.altitude_ft,
                    track: pos.heading_deg.map(|h| h as f64),
                    derived_from: Some("label32".into()),
                });
            }
            AcarsAppPayload::Squitter(sq) => {
                let (Some(latitude), Some(longitude)) = (sq.latitude, sq.longitude) else {
                    return None;
                };
                return Some(DatalinkKinematics {
                    latitude: Some(latitude),
                    longitude: Some(longitude),
                    derived_from: Some("squitter".into()),
                    ..Default::default()
                });
            }
            AcarsAppPayload::OooiOffDestination(_oooi) => {
                return Some(DatalinkKinematics {
                    derived_from: Some("oooi_qf".into()),
                    ..Default::default()
                });
            }
            AcarsAppPayload::OooiOffReport(_oooi) => {
                return Some(DatalinkKinematics {
                    derived_from: Some("oooi_qq".into()),
                    ..Default::default()
                });
            }
            _ => {}
        }
    }

    if let Some(atn) = atn {
        return extract_cpdlc_position(std::iter::once(atn));
    }

    None
}

fn extract_adsc_position(adsc: &AdscMessage) -> Option<DatalinkKinematics> {
    let mut kin = DatalinkKinematics {
        derived_from: Some("adsc".into()),
        ..Default::default()
    };
    let mut found = false;

    for tag in &adsc.tags {
        match tag {
            AdscTag::BasicReport(rep)
            | AdscTag::EmergencyBasicReport(rep)
            | AdscTag::LateralDeviationChangeEvent(rep)
            | AdscTag::VerticalRateChangeEvent(rep)
            | AdscTag::AltitudeRangeEvent(rep)
            | AdscTag::WaypointChangeEvent(rep) => {
                if !found {
                    kin.latitude = Some(rep.latitude);
                    kin.longitude = Some(rep.longitude);
                    kin.altitude_ft = Some(rep.altitude_ft);
                    found = true;
                }
            }
            AdscTag::EarthReferenceData(erd) => {
                if !erd.heading_invalid {
                    kin.track = Some(erd.heading_or_track_degrees);
                }
                found = true;
            }
            AdscTag::AirReferenceData(_ard) => {
                found = true;
            }
            AdscTag::MeteoData(_meteo) => {
                found = true;
            }
            _ => {}
        }
    }

    if found {
        Some(kin)
    } else {
        None
    }
}

fn extract_cpdlc_position<'a, I>(summaries: I) -> Option<DatalinkKinematics>
where
    I: Iterator<Item = &'a CpdlcPduSummary>,
{
    let mut kin = DatalinkKinematics {
        derived_from: Some("cpdlc".into()),
        ..Default::default()
    };

    for summary in summaries {
        for elem in &summary.elements {
            let Some(body) = &elem.body else { continue };

            let extract_pos = |p: &CpdlcPosition| {
                if let CpdlcPosition::LatitudeLongitude {
                    latitude,
                    longitude,
                } = p
                {
                    Some((*latitude, *longitude))
                } else {
                    None
                }
            };

            let extract_alt = |a: &CpdlcAltitude| match a {
                CpdlcAltitude::FlightLevel(fl) => Some(*fl as i32 * 100),
                CpdlcAltitude::QnhFeet(ft) | CpdlcAltitude::QfeFeet(ft) => Some(*ft as i32),
                CpdlcAltitude::GnssFeet(ft) => Some(*ft as i32),
                CpdlcAltitude::FlightLevelMetric(fl) => Some((*fl as i32 * 100000) / 3048),
                CpdlcAltitude::QnhMeters(m) | CpdlcAltitude::QfeMeters(m) => {
                    Some((*m as i32 * 10000) / 3048)
                }
                CpdlcAltitude::GnssMeters(m) => Some((*m as i32 * 10000) / 3048),
            };

            match body {
                CpdlcElementBody::PositionReport(pr) => {
                    if let Some((lat, lon)) = extract_pos(&pr.current_position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                    if let Some(a) = extract_alt(&pr.altitude) {
                        kin.altitude_ft = Some(a);
                    }
                    if let Some(deg) = &pr.true_heading {
                        kin.track = Some(match deg {
                            CpdlcDegrees::True(v) | CpdlcDegrees::Magnetic(v) => *v as f64,
                        });
                    }
                }
                CpdlcElementBody::Position(p) => {
                    if let Some((lat, lon)) = extract_pos(p) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                }
                CpdlcElementBody::PositionAltitude { position, altitude } => {
                    if let Some((lat, lon)) = extract_pos(position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                    if let Some(a) = extract_alt(altitude) {
                        kin.altitude_ft = Some(a);
                    }
                }
                CpdlcElementBody::PositionSpeedSpeed {
                    position,
                    speeds: _speeds,
                } => {
                    if let Some((lat, lon)) = extract_pos(position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                }
                CpdlcElementBody::PositionAltitudeSpeed {
                    position,
                    altitude,
                    speed: _speed,
                } => {
                    if let Some((lat, lon)) = extract_pos(position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                    if let Some(a) = extract_alt(altitude) {
                        kin.altitude_ft = Some(a);
                    }
                }
                CpdlcElementBody::TimePositionAltitude {
                    position, altitude, ..
                }
                | CpdlcElementBody::PositionTimeAltitude {
                    position, altitude, ..
                } => {
                    if let Some((lat, lon)) = extract_pos(position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                    if let Some(a) = extract_alt(altitude) {
                        kin.altitude_ft = Some(a);
                    }
                }
                CpdlcElementBody::TimePositionAltitudeSpeed {
                    position,
                    altitude,
                    speed: _speed,
                    ..
                } => {
                    if let Some((lat, lon)) = extract_pos(position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                    if let Some(a) = extract_alt(altitude) {
                        kin.altitude_ft = Some(a);
                    }
                }
                CpdlcElementBody::PositionDistanceOffsetDirection { position, .. }
                | CpdlcElementBody::PositionIcaoUnitNameFrequency { position, .. }
                | CpdlcElementBody::PositionTime { position, .. }
                | CpdlcElementBody::PositionTimeTime { position, .. } => {
                    if let Some((lat, lon)) = extract_pos(position) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                }
                CpdlcElementBody::PositionPosition { positions } => {
                    if let Some((lat, lon)) = extract_pos(&positions[0]) {
                        kin.latitude = Some(lat);
                        kin.longitude = Some(lon);
                    }
                }
                _ => {}
            }
        }
    }

    if kin.latitude.is_some()
        || kin.longitude.is_some()
        || kin.altitude_ft.is_some()
        || kin.track.is_some()
    {
        Some(kin)
    } else {
        None
    }
}
