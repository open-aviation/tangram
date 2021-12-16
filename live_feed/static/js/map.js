var map = L.map("map", { layers: [] }).setView([43.57155, 1.47165], 7);

var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var airep = L.layerGroup();
var cat = L.layerGroup();

var overlays = {
  Planes: planes,
  Turbulences: turbulences,
  Sigmets: sigmets,
  Airep: airep,
  Cat: cat,
};
function whenClicked(e, feature) {
  var $layer = e.target;
  var highlightStyle = {
    color: "red",
    opacity: 10,
    weight: 50,
  };
  $("#mymodal").modal("show");
  $("#textmodal").text(String(e.target.feature.properties.icao));
  $layer.bringToFront();
  $layer.setStyle(highlightStyle);
}
function onEachPlane(feature, layer) {
  var popupContent = "<p>ICAO: " + feature.properties.icao + "</p>";
  layer.bindPopup(popupContent);
  layer.on({
    click: whenClicked,
  });
}

function onEachAirep(feature, layer) {
  var popupContent =
    "<p>Callsign: " +
    feature.properties.callsign +
    "<br>ICAO: " +
    feature.properties.icao24 +
    "<br>Typecode: " +
    feature.properties.typecode +
    "<br>From: " +
    feature.properties.created +
    "<br>To: " +
    feature.properties.expire +
    "<br>Phenomenon: " +
    feature.properties.phenomenon +
    "</p>";
  layer.bindPopup(popupContent);
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

function createCustomIcon(feature, latlng) {
  let myIcon = L.icon({
    iconUrl: "plane.png",
    iconSize: [30, 30], // width and height of the image in pixels
    iconAnchor: [12, 12], // point of the icon which will correspond to marker's location
    popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
  });
  return L.marker(latlng, {
    icon: myIcon,
    rotationAngle: feature.properties.dir,
  });
}

let myLayerOptions = {
  onEachFeature: onEachPlane,
  pointToLayer: createCustomIcon,
};

setInterval(function () {
  $.getJSON("planes.geojson", function (data) {
    planes.clearLayers();
    L.geoJson(data, myLayerOptions).addTo(planes);
  });

  $.getJSON("turb.geojson", function (data) {
    turbulences.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachPlane,
    }).addTo(turbulences);
  });
  map = L.map("map", { layers: [] }).setView([43.57155, 1.47165], 7);
}, 3000);

$.getJSON("sigmet.geojson", function (data) {
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

$.getJSON("airep.geojson", function (data) {
  L.geoJson(data, {
    onEachFeature: onEachAirep,
  }).addTo(airep);
});

$.getJSON("cat.geojson", function (data) {
  L.geoJson(data).addTo(cat);
});

var baselayer = L.tileLayer(
  "http://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="http://cartodb.com/attributions">CartoDB</a>',
  }
);

// The first parameter are the coordinates of the center of the map
// The second parameter is the zoom level

// L.control
//   .liveupdate({
//     update_map: function () {
//       planes.clearLayers();
//       $.getJSON("results.geojson", function (data) {
//         L.geoJson(data, {
//           onEachFeature: onEachFeature,
//         }).addTo(planes);
//       });
//     },
//     interval: 5000,
//   })
//   .addTo(map)
//   .startUpdating();

L.control.scale().addTo(map);
L.control.layers(null, overlays).addTo(map);
map.addLayer(baselayer);
