var map = L.map("map", { layers: [] }).setView([43.57155, 1.47165], 7);

var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var aireps = L.layerGroup();
var cat = L.layerGroup();

var overlays = {
  Planes: planes,
  Turbulences: turbulences,
  Sigmets: sigmets,
  Airep: aireps,
  Cat: cat,
};
let myLayerOptions = {
  onEachFeature: onEachPlane,
  pointToLayer: createCustomIcon,
};
// function getPlanes() {
//   $.getJSON("/planes.geojson", function (data) {
//     var avion = document.getElementById("plane_count");
//     avion.innerHTML = Object.keys(data.features).length;

//     planes.clearLayers();
//     L.geoJson(data, myLayerOptions).addTo(planes);
//   });
// }
getPlanes();
// function getTurbulence() {
//   $.getJSON("/turb.geojson", function (data) {
//     turbulences.clearLayers();
//     L.geoJson(data, {
//       onEachFeature: onEachTurb,
//     }).addTo(turbulences);
//   });
// }
getTurbulence();
getSigmet();
getAirep();
getCat();
// partie slider
function createTemporalLegend(startTimestamp) {
  var temporalLegend = L.control({ position: "bottomleft" });

  temporalLegend.onAdd = function (map) {
    var output = L.DomUtil.create("output", "temporal-legend");
    $(output).text(startTimestamp);
    return output;
  };

  temporalLegend.addTo(map);
}
function createSliderUI() {
  var sliderControl = L.control({ position: "bottomleft" });

  sliderControl.onAdd = function (map) {
    var slider = L.DomUtil.create("input", "range-slider");

    L.DomEvent.addListener(slider, "mousedown", function (e) {
      L.DomEvent.stopPropagation(e);
    });
    $(slider).attr({
      type: "range",
      max: Date.parse("2022-01-15T00:00:00"),
      min: Date.parse("2022-01-14T00:00:00"),
      value: new Date("2022-01-14T00:00:00"),
      step: 1,
    });
    $(slider).on("input change", function () {
      getSigmet($(this).attr("min"), $(this).val().toString());
      getAirep($(this).attr("min"), $(this).val().toString());
      $(".temporal-legend").text(new Date($(this).val() * 1));
    });
    return slider;
  };

  sliderControl.addTo(map);
  createTemporalLegend(new Date());
}
createSliderUI();

var baselayer = L.tileLayer(
  "http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="http://cartodb.com/attributions">CartoDB</a>',
  }
);
L.control.scale().addTo(map);
L.control.layers(null, overlays).addTo(map);
map.addLayer(baselayer);
