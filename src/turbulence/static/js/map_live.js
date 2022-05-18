var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var aireps = L.layerGroup();
var cat_mod = L.layerGroup();
var cat_sev = L.layerGroup();
var heatmapLayer = L.layerGroup();

chart_history = 0;

var map = L.map("map", { layers: [cat_mod, cat_sev, sigmets, aireps, turbulences, planes], scrollWheelZoom: false}).setView([46, 2], 6);
var sidebar = L.control.sidebar({ container: "sidebar" });
sidebar.addTo(map);
var overlays = {
  Cat_mod: cat_mod,
  Cat_sev: cat_sev,
  Sigmets: sigmets,
  Airep: aireps,
  Turbulences: turbulences,
  Planes: planes,
  Heatmap: heatmapLayer,
};
let myLayerOptions = {
  onEachFeature: onEachPlane,
  pointToLayer: createCustomIcon,
};
getCat();
getSigmet();
getAirep();
setInterval(function () {
  getSigmet();
  getAirep();
}, 1000 * 60 * 5); //5 minutes
setInterval(function () {
  getCat();
}, 1000 * 60 * 10); //10 minutes

var baselayer = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://cartodb.com/attributions">CartoDB</a>',
  }
);
// var 
L.control
  .liveupdate({
    update_map: function () {
      getPlanes();
      getTurbulence();
      getheatmap();
    },
    interval: 1000 * 10, //10 secondes
  })
  .addTo(map)
  .startUpdating();

L.control.scale().addTo(map);
// L.control.zoom({ position: "topright" }).addTo(map);
L.control.layers(null, overlays).addTo(map);
map.addLayer(baselayer);

var UptimeSec = document.getElementById("seconds_uptime").textContent;
document.getElementById("info_time").html = "<td>" + getTimeString(false) + "</td><td>" + getTimeString(true) + "</td>";
setInterval(function () {

  distance = UptimeSec++;
  var days = Math.floor(distance / (60 * 60 * 24));
  var hours = Math.floor((distance % (60 * 60 * 24)) / (60 * 60));
  var minutes = Math.floor((distance % (60 * 60)) / 60);
  var seconds = Math.floor((distance % 60));
  var d = days == 0 ? "" : days + "d ";
  var h = hours == 0 ? "" : hours + "h ";
  document.getElementById("uptime").innerHTML = d + h + minutes + "m " + seconds + "s ";
  document.getElementById("info_time").innerHTML = "<td>" + getTimeString(false) + "</td>" + "<td>" + getTimeString(true) + "</td>";
}, 1000 * 1);//1 secondes

setInterval(function () {
  url = "uptime"
  $.getJSON(url, function (data) {
    UptimeSec = data.uptime
  })
}, 1000 * 60);//1 minute

// map.on('zoomend', function (feature) {
//   var currentZoom = map.getZoom();
//   if (currentZoom < 7) {
//     feature.marker.setIcon(new L.icon({
//       iconUrl: "plane.png",
//       iconSize: [10, 10], // width and height of the image in pixels
//       iconAnchor: [12, 12], // point of the icon which will correspond to marker's location
//       popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
//     }));
//   }
// });