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
