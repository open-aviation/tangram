var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var aireps = L.layerGroup();
var cat_mod = L.layerGroup();
var cat_sev = L.layerGroup();
var options = {
  radius: 8,
  opacity: 0.5,
};

var hexLayer = L.hexbinLayer(options);
var baselayer = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://cartodb.com/attributions">CartoDB</a>',
  }
);

chart_history = 0;
var traj = L.layerGroup();
var map = L.map("map", {
  layers: [cat_mod, cat_sev, sigmets, aireps, turbulences, planes],
}).setView([46, 2], 6);
var fullscreenControl = L.control.fullscreen();
map.addControl(fullscreenControl);
map.on("click", function (e) {
  if (e.originalEvent.target.classList.contains("turb_selected")) {
    return;
  }
  deselect_planes();

  sidebar.close();
});
map.addLayer(traj);
map.addLayer(baselayer);
var sidebar = L.control.sidebar({ container: "sidebar" });
sidebar.addTo(map);
hexLayer.colorScale().range(["gray", "green", "orange", "red"]);

hexLayer
  .radiusRange([2, 20])
  .lng(function (d) {
    return d[0];
  })
  .lat(function (d) {
    return d[1];
  })
  .radiusValue(function (d) {
    return d.length;
  })
  .colorValue(function (d) {
    var intensity_sum = d.reduce(function (acc, obj) {
      return acc + obj["o"][3];
    }, 0);
    return intensity_sum;
  })
  .hoverHandler(
    L.HexbinHoverHandler.compound({
      handlers: [
        L.HexbinHoverHandler.resizeFill(),
        L.HexbinHoverHandler.tooltip(),
      ],
    })
  );
var overlays = {
  Cat_mod: cat_mod,
  Cat_sev: cat_sev,
  Sigmets: sigmets,
  Airep: aireps,
  Turbulences: turbulences,
  Planes: planes,
  Hexbins: hexLayer,
};
getCat();
getSigmet();
getAirep();
getPlanes();
getTurbulence();
setInterval(function () {
  getSigmet();
  getAirep();
}, 1000 * 60 * 5); //5 minutes
setInterval(function () {
  getCat();
}, 1000 * 60 * 10); //10 minutes
setInterval(function () {
  getPlanes();
  getTurbulence();
}, 1000 * 5); //10 secondes
L.control.scale().addTo(map);
// L.control.zoom({ position: "topright" }).addTo(map);
L.control.layers(null, overlays).addTo(map);
var UptimeSec = document.getElementById("seconds_uptime").textContent;
document.getElementById("info_utc").innerHTML = getTimeString(false);
document.getElementById("info_local").innerHTML = getTimeString(true);
setInterval(function () {
  distance = UptimeSec++;
  var days = Math.floor(distance / (60 * 60 * 24));
  var hours = Math.floor((distance % (60 * 60 * 24)) / (60 * 60));
  var minutes = Math.floor((distance % (60 * 60)) / 60);
  var seconds = Math.floor(distance % 60);
  var d = days == 0 ? "" : days + "d ";
  var h = hours == 0 ? "" : hours + "h ";
  document.getElementById("uptime").innerHTML =
    d + h + minutes + "m " + seconds + "s ";
  document.getElementById("info_utc").innerHTML = getTimeString(false);
  document.getElementById("info_local").innerHTML = getTimeString(true);
}, 1000 * 1); //1 secondes

setInterval(function () {
  url = "uptime";
  $.getJSON(url, function (data) {
    UptimeSec = data.uptime;
  });
}, 1000 * 60); //1 minute

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
