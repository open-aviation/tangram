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
