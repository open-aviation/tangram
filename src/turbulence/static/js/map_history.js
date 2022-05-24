var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var aireps = L.layerGroup();
var cat_mod = L.layerGroup();
var cat_sev = L.layerGroup();
var heatmapLayer = L.layerGroup();

chart_history = 1;

var map = L.map("map", { layers: [planes, turbulences] }).setView([43.57155, 1.47165], 7);

var overlays = {
  Planes: planes,
  Turbulences: turbulences,
  Sigmets: sigmets,
  Airep: aireps,
  Cat_mod: cat_mod,
  Cat_sev: cat_sev,
  Heatmap: heatmapLayer,
};
// Date 
const urlSearchParams = new URLSearchParams(window.location.search);
var min_date = urlSearchParams.get('min');
var max_date = urlSearchParams.get('max');

var firstseen = document.getElementById("first_seen");
firstseen.innerHTML = new Date(min_date).toUTCString();
var lastseen = document.getElementById("last_seen");
lastseen.innerHTML = new Date(max_date).toUTCString();

// Requests
$.ajaxSetup({
  async: false
});
getPlanes(Date.parse(min_date), history = 1);
var turbu = getTurbulence(und = "", history = 1);
var sig = getSigmet(Date.parse(min_date), Date.parse(max_date));
var air = getAirep(Date.parse(min_date), Date.parse(max_date));
var cleanair = getCat(Date.parse(min_date), Date.parse(max_date));
getheatmap(und = null, history = 1);
$.ajaxSetup({
  async: true
});
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
      max: Date.parse(max_date),
      min: Date.parse(min_date),
      value: new Date(min_date),
      step: 600000,
    });
    $(slider).on("input change", function () {
      filtersigmet(sig, $(this).val() / 1000);
      filterairep(air, $(this).val() / 1000);
      filtercat(cleanair, $(this).val() / 1000);
      filterturb(turbu, $(this).val() / 1000);
      getPlanes($(this).val().toString(), history = 1);
      // filterheatmap(heatm, $(this).val().toString());
      getheatmap($(this).val().toString(), history = 1);
      $(".temporal-legend").text(new Date($(this).val() * 1).toUTCString());
    });
    return slider;
  };

  sliderControl.addTo(map);
  createTemporalLegend(new Date(min_date).toUTCString());
}
createSliderUI();
// function createAltitudeLegend(startTimestamp) {
//   var altitudeLegend = L.control({ position: "right" });

//   altitudeLegend.onAdd = function (map) {
//     var output = L.DomUtil.create("output", "altitude-legend");
//     $(output).text(startTimestamp);
//     return output;
//   };

//   altitudeLegend.addTo(map);
// }
// function createSliderAltitude() {
//   var sliderControl = L.control({ position: "right" });

//   sliderControl.onAdd = function (map) {
//     var slider = L.DomUtil.create("input", "range-slider");

//     L.DomEvent.addListener(slider, "mousedown", function (e) {
//       L.DomEvent.stopPropagation(e);
//     });
//     $(slider).attr({
//       type: "range",
//       max: 50000,
//       min: 0,
//       value: 25000,
//       step: 1000,
//     });
//     $(slider).on("input change", function () {
//       // getSigmet($(this).attr("min"), $(this).val().toString());
//       // getAirep($(this).attr("min"), $(this).val().toString());

//       $(".temporal-legend").text(new Date($(this).val() * 1).toUTCString());
//     });
//     return slider;
//   };

//   sliderControl.addTo(map);
//   createTemporalLegend(new Date(min_date).toUTCString());
// }

var baselayer = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://cartodb.com/attributions">CartoDB</a>',
  }
);
L.control.scale().addTo(map);
L.control.layers(null, overlays).addTo(map);
map.addLayer(baselayer);
