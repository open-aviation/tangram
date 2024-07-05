var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var aireps = L.layerGroup();
var cat_mod = L.layerGroup();
var cat_sev = L.layerGroup();
var traj = L.layerGroup();

var options = { radius: 8, opacity: 0.5 };

var hexLayer = L.hexbinLayer(options);
var baselayer = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://cartodb.com/attributions">CartoDB</a>',
  }
);

var layers = [cat_mod, cat_sev, sigmets, aireps, turbulences, planes, traj];
var map = L.map("map", { layers }).setView([48, 5], 5);

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

// channel.js api: https://hexdocs.pm/phoenix/js/
// init socket

console.log("channel script");
const { Socket, Presence, Channel } = Phoenix;
const debug = false;
const userToken = "joining-token";
let socket = new Socket("", { debug, params: { userToken } });
socket.connect();

let streamingChannelName = "channel:streaming";
const streamingChannelToken = "channel-token";
let streamingChannel = socket.channel(streamingChannelName, { token: streamingChannelToken });
// console.dir(channel);

streamingChannel.on("new-data", renderPlanes);

function updateEl({ el, html }) {
  morphdom(document.getElementById(el), html);
}

streamingChannel.on('uptime', updateEl);
streamingChannel.on('info_local', updateEl);
streamingChannel.on('info_utc', updateEl);

streamingChannel
  .join()
  .receive("ok", ({ messages }) => {
    console.log(`(${streamingChannelName}) joined`, messages);
  })
  .receive("error", ({ reason }) =>
    console.log(`failed to join ${streamingChannelName}`, reason)
  )
  .receive("timeout", () => console.log(`timeout joining ${streamingChannelName}`));

function publishEvent(channel, event, payload) {
  channel.push(`event:${event}`, payload)
    .receive("ok", (resp) => console.log(`${channel.topic} publishEvent ${event}`, resp));
}

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

/// update
var UptimeSec = document.getElementById("seconds_uptime").textContent;
document.getElementById("info_utc").innerHTML = getTimeString(false);
document.getElementById("info_local").innerHTML = getTimeString(true);
let uptimeEl = document.getElementById("uptime");

function updateUptime() {
  distance = UptimeSec++;
  var days = Math.floor(distance / (60 * 60 * 24));
  var hours = Math.floor((distance % (60 * 60 * 24)) / (60 * 60));
  var minutes = Math.floor((distance % (60 * 60)) / 60);
  var seconds = Math.floor(distance % 60);
  var d = days == 0 ? "" : days + "d ";
  var h = hours == 0 ? "" : hours + "h ";

  uptimeEl.innerHTML = d + h + minutes + "m " + seconds + "s ";

  document.getElementById("info_utc").innerHTML = getTimeString(false);
  document.getElementById("info_local").innerHTML = getTimeString(true);
}

// setInterval(updateUptime, 1000 * 1); // 1 secondes

setInterval(() => $.getJSON('uptime', function (data) { UptimeSec = data.uptime; }), 1000 * 60); // 1 minute
