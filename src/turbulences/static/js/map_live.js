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
getSigmet();
getAirep();
setInterval(function () {
  getSigmet();
  getAirep();
}, 10000);
getCat();

var baselayer = L.tileLayer(
  "http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="http://cartodb.com/attributions">CartoDB</a>',
  }
);

L.control
  .liveupdate({
    update_map: function () {
      getPlanes();
      getTurbulence();
    },
    interval: 4000,
  })
  .addTo(map)
  .startUpdating();

L.control.scale().addTo(map);
L.control.layers(null, overlays).addTo(map);
map.addLayer(baselayer);
