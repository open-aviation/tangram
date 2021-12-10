var planes = L.layerGroup();
var turbulences = L.layerGroup();
var sigmets = L.layerGroup();
var airep = L.layerGroup();

var overlays = {
  Planes: planes,
  Turbulences: turbulences,
  Sigmets: sigmets,
  Airep: airep,
};

var map = L.map("map", { layers: [] }).setView([43.57155, 1.47165], 7);

function whenClicked(e, feature) {
  $("#mymodal").modal("show");
  $("#textmodal").text(String(e.target.feature.properties.icao));
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
    feature.properties.aircraft_callsign +
    "<br>ICAO: " +
    feature.properties.aircraft_icao24 +
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
