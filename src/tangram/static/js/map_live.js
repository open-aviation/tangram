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

var minAltitude = 3000 // min altitude
var maxAltitude = 50000 // max altitude

console.log('init----------------------------------')


$(".js-range-slider").ionRangeSlider({
  type: "double",
  min: 3000,
  max: 50000,
  from: 3000,
  to: 50000,
  step: 100,
  grid: false,
  onFinish: function (data) {
    minAltitude = data.from
    maxAltitude = data.to
    if(!window.Data) {
      return
    }
    var filteredData = window.Data.filter(function(item) {
      return item.altitude >= minAltitude && item.altitude <= maxAltitude
    })
    planeInfo(filteredData)
}
});

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
}).setView([48, 5], 5);
var fullscreenControl = L.control.fullscreen();
map.addControl(fullscreenControl);
map.on("click", function (e) {
  if (
    e.originalEvent.target.classList.contains("turb_selected") |
    (e.originalEvent.target.id == "myChart")
  ) {
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
  });
var overlays = {
  CAT_moderate: cat_mod,
  CAT_severe: cat_sev,
  SIGMET: sigmets,
  AIREP: aireps,
  Turbulences: turbulences,
  Planes: planes,
  hexbins: hexLayer,
};

// init socket

console.log("channel script");
const { Socket, Presence, Channel } = Phoenix;
const debug = false;
const userToken = "joining-token";
let socket = new Socket("", { debug, params: { userToken } });
socket.connect();

let systemChannel = "channel:streaming";
const systemChannelToken = "channel-token";
let channel = socket.channel(systemChannel, { token: systemChannelToken });
console.dir(channel);

channel.on("new-traffic", (data) => {
  console.log(`(${systemChannel}/traffic)>`, data);
});

channel.on("new-turb", (data) => {
  console.log(`(${systemChannel}/turb)>`, data);
});

channel.on('new-data', data => {

  window.Data = data
  var filteredData = data.filter(function(item) {
    return item.altitude >= minAltitude && item.altitude <= maxAltitude
  })
  planeInfo(filteredData)
});

channel
  .join()
  .receive("ok", ({ messages }) => {
    console.log(`(${systemChannel}) joined`, messages);
  })
  .receive("error", ({ reason }) =>
    console.log(`failed to join ${systemChannel}`, reason)
  )
  .receive("timeout", () => console.log(`timeout joining ${systemChannel}`));

//getCat();
//getSigmet();
//getAirep();
//getPlanes();
//// getTurbulence();
//setInterval(function () {
//  getSigmet();
//  getAirep();
//}, 1000 * 60 * 5); //5 minutes
//setInterval(function () {
//  getCat();
//}, 1000 * 60 * 10); //10 minutes
// setInterval(function () {
//   getPlanes();
//   getTurbulence();
// }, 1000 * 2); //2 secondes
// L.control.scale().addTo(map);
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
