function filterturb(data, time) {
  turbulences.clearLayers();
  if ($.isEmptyObject(data.geojson)) {
    return;
  }
  L.geoJson(data.geojson, {
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
    filter: function (feature) {
      return feature.properties.start <= time;
    },
  }).addTo(turbulences);
}
function filterairep(data, time) {
  aireps.clearLayers();
  if ($.isEmptyObject(data)) {
    return;
  }
  filtered = L.geoJson(data, {
    onEachFeature: onEachAirep,
    filter: function (feature) {
      return (
        Date.parse(feature.properties.expire) / 1000 >= time &&
        Date.parse(feature.properties.reported_time) / 1000 <= time
      );
    },
  });
  filtered.addTo(aireps);
}
function filtersigmet(data, time) {
  sigmets.clearLayers();
  if ($.isEmptyObject(data)) {
    return;
  }
  filtered = L.geoJson(data, {
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
    filter: function (feature) {
      return (
        Date.parse(feature.properties.validTimeTo) / 1000 >= time &&
        Date.parse(feature.properties.validTimeFrom) / 1000 <= time
      );
    },
  });
  filtered.addTo(sigmets);
}
function filtercat(data, time) {
  cat_sev.clearLayers();
  cat_mod.clearLayers();
  if ($.isEmptyObject(data)) {
    return;
  }
  L.geoJson(data, {
    filter: function (feature) {
      return (
        feature.properties.intensityValue == 2 &&
        Date.parse(feature.properties.endValidity) / 1000 >= time &&
        Date.parse(feature.properties.startValidity) / 1000 <= time
      );
    },
    style: function () {
      return { color: "red", opacity: 0 };
    },
    onEachFeature: onEachCat,
  }).addTo(cat_sev);
  L.geoJson(data, {
    filter: function (feature) {
      return (
        feature.properties.intensityValue == 1 &&
        Date.parse(feature.properties.endValidity) / 1000 >= time &&
        Date.parse(feature.properties.startValidity) / 1000 <= time
      );
    },
    style: function () {
      return { color: "gray", opacity: 0 };
    },
    onEachFeature: onEachCat,
  }).addTo(cat_mod);
}
