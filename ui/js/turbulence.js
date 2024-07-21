
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
        var icao24 = feature.geometry.properties.icao24;
        var intensity = feature.geometry.properties.intensity;
        var color = function () {
          return intensity >= 200
            ? "#8400ff"
            : (intensity < 200) & (intensity > 100)
              ? "#ff9900"
              : "#0084ff";
        };
        if (icao24 === selected.icao24) {
          return { className: "turb_selected turb-" + icao24, color: color() };
        }
        return { className: "turb_path turb-" + icao24, color: color() };
      },
      // function (feature) {
      //   var icao = feature.properties.icao;
      //   return icao == selected.icao24
      //     ? { className: "turb_selected" }
      //     : {
      //       className: "turb_path"
      //     };
      // }
    }).addTo(turbulences);
    heatm = data.geojson.features;
    var values = [];
    var res = [];
    heatm.forEach(function (key) {
      for (var i = 0, l1 = key.coordinates.length; i < l1; i++) {
        key.coordinates[i][3] = key.properties.intensity;
        res.push(key.coordinates[i]);
      }
      // values.push(Object.values());
    });

    hexLayer.data(res);
    // turb_geojson.eachLayer(function (layer) {
    //   layer._path.id = 'turb-' + layer.feature.geometry.properties.icao;
    // });
  });
  return turbu;
}


function onEachTurb(feature, layer) {
  layer.on({ click: onPlaneClicked });
}
