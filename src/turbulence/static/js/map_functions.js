var chart_history;
var selected = null;
function getFlight_data(icao, callsign, typecode) {
  document.getElementById("icao").innerHTML = icao;
  document.getElementById("typecode").innerHTML = typecode;
  var aircraft_id = document.getElementById("aircraft_id");
  aircraft_id.innerHTML = callsign;
  url = "context/flight/" + icao;
  $.getJSON(url, function (data) {
    flight_id = document.getElementById("flight_id");
    departure = document.getElementById("departure");
    destination = document.getElementById("destination");

    if (data.flightId === undefined) {
      flight_id.innerHTML = "";
      departure.innerHTML = "";
      destination.innerHTML = "";
    } else {
      flight_id.innerHTML = data.flightId.id;
      departure.innerHTML = data.flightId.keys.aerodromeOfDeparture;
      destination.innerHTML = data.flightId.keys.aerodromeOfDestination;
      aircraft_id.innerHTML = data.flightId.keys.aircraftId;
    }
  });
  document.getElementById("flight").hidden = false;
}
function deselect_planes() {
  traj.clearLayers();
  $(".aircraft_selected").toggleClass("aircraft_img", true);
  $(".aircraft_selected").toggleClass("aircraft_selected", false);
  $(".turb_selected").toggleClass("turb_path", true);
  $(".turb_selected").toggleClass("turb_selected", false);
  selected = "";
}
function whenClicked(e) {
  deselect_planes();
  var icao =
    e.target.feature.properties.icao === undefined
      ? e.target.feature.geometry.properties.icao
      : e.target.feature.properties.icao;
  var callsign =
    e.target.feature.properties.callsign === undefined
      ? e.target.feature.geometry.properties.callsign
      : e.target.feature.properties.callsign;
  var typecode =
    e.target.feature.properties.typecode === undefined
      ? e.target.feature.geometry.properties.typecode
      : e.target.feature.properties.typecode;
  selected = icao;
  $("#" + icao).toggleClass("aircraft_img", false);
  $("#" + icao).toggleClass("aircraft_selected", true);
  $(".turb-" + icao).toggleClass("turb_path", false);
  $(".turb-" + icao).toggleClass("turb_selected", true);
  draw_chart(icao, chart_history);
  getTrajectory(icao, chart_history);
  getFlight_data(icao, callsign, typecode);
  sidebar.open("info_box");
}
function onEachPlane(feature, layer) {
  let icao = feature.properties.icao;
  if (icao == selected) {
    getTrajectory(icao, chart_history);
  }
  var popupContent =
    "<p>ICAO: " +
    icao +
    "<br>Callsign: " +
    feature.properties.callsign +
    "</p>";

  layer.bindPopup(popupContent);
  layer.on({
    click: whenClicked,
  });
  layer.on({
    mouseover: function (e) {
      this.openPopup();
    },
  });
  layer.on({
    mouseout: function (e) {
      this.closePopup();
    },
  });
}
function onEachTurb(feature, layer) {
  layer.on({
    click: whenClicked,
  });
}

function onEachAirep(feature, layer) {
  var popupContent =
    "<p>Callsign: " +
    feature.properties.callsign +
    "<br>ICAO: " +
    feature.properties.icao24 +
    "<br>Typecode: " +
    feature.properties.typecode +
    "<br>From: " +
    feature.properties.created +
    "<br>To: " +
    feature.properties.expire +
    "<br>Phenomenon: " +
    feature.properties.phenomenon +
    "<br>Altitude: " +
    feature.properties.altitude +
    "</p>";
  layer.bindPopup(popupContent);
}

function onEachSigmet(feature, layer) {
  var popupContent =
    "<p>id Sigmet: " +
    feature.properties.idSigmet +
    "<br>Hazard: " +
    feature.properties.hazard +
    "<br>From: " +
    feature.properties.validTimeFrom +
    "<br>To: " +
    feature.properties.validTimeTo +
    "</p>";
  layer.bindPopup(popupContent);
}

function onEachCat(feature, layer) {
  var popupContent =
    "<p>id Cat: " +
    feature.properties.identifier +
    "<br>Start: " +
    feature.properties.startValidity +
    "<br>End: " +
    feature.properties.endValidity +
    "<br>Intensity: " +
    feature.properties.intensity +
    "<br>Intensity value: " +
    feature.properties.intensityValue +
    "</p>";
  layer.bindPopup(popupContent);
}
function createCustomIcon(feature, latlng) {
  var imageObj = get_image_object(
    feature.properties.typecode,
    feature.properties.callsign
  );
  var view_box = 34 / imageObj.scale;
  var stroke_width = 0.8 / imageObj.scale;
  var svg =
    "<svg id='" +
    feature.properties.icao +
    "' xmlns='http://www.w3.org/2000/svg' version='1.0' viewBox='0 0 " +
    view_box +
    " " +
    view_box +
    "'><g transform='scale(" +
    0.7 +
    ")'><path d='" +
    imageObj.path +
    "' stroke='#0014aa' stroke-width='" +
    stroke_width +
    "'></path></g></svg >";
  let myIcon = L.divIcon({
    html: svg,
    className:
      feature.properties.icao != selected
        ? "aircraft_img"
        : "aircraft_selected",
    iconSize: [33, 35], // width and height of the image in pixels
    iconAnchor: [15, 15], // point of the icon which will correspond to marker's location
    popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
    color: "blue",
  });
  let marker = L.marker(latlng, {
    icon: myIcon,
    rotationAngle: (feature.properties.dir + imageObj.rotcorr) % 360,
  });
  return marker;
}
function getSigmet(wef = null, und = null) {
  var url = "context/sigmet";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + "?" + searchParams;
  }
  var sigmet;
  $.getJSON(url, function (data) {
    if (data.features == undefined) {
      data["features"] = {};
    }
    document.getElementById("sigmet_count").innerHTML = Object.keys(
      data.features
    ).length;
    sigmet = data;
    sigmets.clearLayers();
    L.geoJson(data, {
      style: function (feature) {
        var d = feature.properties.hazard;
        return d == "TS"
          ? { color: "red" }
          : d == "TURB"
          ? { color: "blue" }
          : d == "MTW"
          ? { color: "yellow" }
          : d == "ICE"
          ? { color: "gray" }
          : { color: "black" };
      },
      onEachFeature: onEachSigmet,
    }).addTo(sigmets);
  });
  return sigmet;
}
function getAirep(wef = null, und = null) {
  url = "context/airep";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + "?" + searchParams;
  }
  var airep;
  $.getJSON(url, function (data) {
    if (data.features == undefined) {
      data["features"] = {};
    }
    document.getElementById("airep_count").innerHTML = Object.keys(
      data.features
    ).length;
    airep = data;
    aireps.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachAirep,
    }).addTo(aireps);
  });
  return airep;
}
function getCat(wef = null, und = null) {
  url = "context/cat";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + "?" + searchParams;
  }
  var cat;
  $.getJSON(url, function (data) {
    cat_sev.clearLayers();
    cat_mod.clearLayers();
    if ($.isEmptyObject(data)) {
      return;
    }
    cat = data;
    L.geoJson(data, {
      filter: function (feature) {
        return feature.properties.intensityValue == 2;
      },
      style: function () {
        return { color: "red", opacity: 0 };
      },
      onEachFeature: onEachCat,
    }).addTo(cat_sev);
    L.geoJson(data, {
      filter: function (feature) {
        return feature.properties.intensityValue == 1;
      },
      style: function () {
        return { color: "gray", opacity: 0 };
      },
      onEachFeature: onEachCat,
    }).addTo(cat_mod);
  });
  return cat;
}
function getPlanes(und = "", history = 0, icao24 = "", callsign = "") {
  url = "planes.geojson";
  const searchParams = new URLSearchParams({
    history: history,
    und: und,
    icao24: icao24,
    callsign: callsign,
  });
  url = url + "?" + searchParams;

  $.getJSON(url, function (data) {
    var avion = document.getElementById("plane_count");
    avion.innerHTML = data.count;

    planes.clearLayers();
    L.geoJson(data.geojson, {
      onEachFeature: onEachPlane,
      pointToLayer: createCustomIcon,
    }).addTo(planes);
  });
}
function getTurbulence(und = "", history = 0, icao24 = "", callsign = "") {
  url = "turb.geojson";
  const searchParams = new URLSearchParams({
    history: history,
    und: und,
    icao24: icao24,
    callsign: callsign,
  });
  url = url + "?" + searchParams;

  var turbu;
  $.getJSON(url, function (data) {
    turbu = data;
    turbulences.clearLayers();
    var turb_geojson = L.geoJson(data.geojson, {
      onEachFeature: onEachTurb,
      style: function (feature) {
        var icao = feature.geometry.properties.icao;
        var intensity = feature.geometry.properties.intensity;
        var color = function () {
          return intensity >= 200
            ? "#8400ff"
            : (intensity < 200) & (intensity > 100)
            ? "#ff9900"
            : "#0084ff";
        };
        if (icao == selected) {
          return { className: "turb_selected turb-" + icao, color: color() };
        }
        return { className: "turb_path turb-" + icao, color: color() };
      },
      // function (feature) {
      //   var icao = feature.properties.icao;
      //   return icao == selected
      //     ? { className: "turb_selected" }
      //     : {
      //       className: "turb_path"
      //     };
      // }
    }).addTo(turbulences);
    // turb_geojson.eachLayer(function (layer) {
    //   layer._path.id = 'turb-' + layer.feature.geometry.properties.icao;
    // });
  });
  return turbu;
}
function getheatmap(und = null, history = 0) {
  url = "heatmap.data";
  if (und !== null) {
    url = url + "/" + und;
  }
  if (history) {
    const searchParams = new URLSearchParams({ history: history });
    url = url + "?" + searchParams;
  }
  var heatm;
  $.getJSON(url, function (data) {
    heatm = data.data;
    heatmapLayer.clearLayers();
    L.heatLayer(data.data, { radius: 25 }).addTo(heatmapLayer);
  });
  return heatm;
}
function getTimeString(isLocal) {
  var hours;
  var minutes;
  var date = new Date();

  if (isLocal) {
    hours = date.getHours();
    minutes = date.getMinutes();
  } else {
    hours = date.getUTCHours();
    minutes = date.getUTCMinutes();
  }

  if (hours < 10) {
    hours = "0" + hours;
  }
  if (minutes < 10) {
    minutes = "0" + minutes;
  }

  var zeit_string = hours + ":" + minutes;

  return zeit_string;
}
function getTrajectory(icao, und = "", history = 0) {
  url = "trajectory/" + icao;
  const searchParams = new URLSearchParams({ history: history, und: und });
  url = url + "?" + searchParams;
  $.getJSON(url, function (data) {
    traj.clearLayers();
    L.geoJson(data.geojson, {
      color: "black",
    }).addTo(traj);
  });
}
