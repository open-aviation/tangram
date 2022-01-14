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

function whenClicked(e) {
  draw_chart(e.target.feature.properties.icao);
}
function onEachPlane(feature, layer) {
  var popupContent = "<p>ICAO: " + feature.properties.icao + "</p>";
  layer.bindPopup(popupContent);
  layer.on({
    click: whenClicked,
  });
}
function onEachTurb(feature, layer) {
  var popupContent = "<p>ICAO: " + feature.properties.icao + "</p>";
  layer.bindPopup(popupContent);
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

function createCustomIcon(feature, latlng) {
  let myIcon = L.icon({
    iconUrl: "/plane.png",
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

function loadTable(tableId, fields, data) {
  var rows = "";
  $.each(data, function (index, item) {
    var row = "<tr>";
    $.each(fields, function (index, field) {
      row += "<td>" + item["properties"][field + ""] + "</td>";
    });
    rows += row + "<tr>";
  });
  $("#" + tableId + " tbody").html(rows);
}
setInterval(function () {
  $.getJSON("/sigmet.geojson", function (data) {
    loadTable(
      "table_sigmet",
      ["idSigmet", "hazard", "validTimeFrom", "validTimeTo", "firName"],
      data["features"]
    );

    document.getElementById("sigmet_count").innerHTML = Object.keys(
      data.features
    ).length;
    sigmets.clearLayers();
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

  $.getJSON("/airep.geojson", function (data) {
    loadTable(
      "table_airep",
      [
        "callsign",
        "icao24",
        "typecode",
        "phenomenon",
        "altitude",
        "center",
        "created",
        "expire",
        "reported_time",
        "updated",
      ],
      data["features"]
    );

    document.getElementById("airep_count").innerHTML = Object.keys(
      data.features
    ).length;
    aireps.clearLayers();

    L.geoJson(data, {
      onEachFeature: onEachAirep,
    }).addTo(aireps);
  });
}, 10000);
//

$.getJSON("/cat.geojson", function (data) {
  L.geoJson(data, {
    style: function (feature) {
      var d = feature.properties.intensityValue;
      return d == 1
        ? { color: "blue" }
        : d == 2
        ? { color: "red" }
        : { color: "black" };
    },
    onEachFeature: onEachCat,
  }).addTo(cat);
});

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
      $.getJSON("/planes.geojson", function (data) {
        var avion = document.getElementById("plane_count");
        avion.innerHTML = Object.keys(data.features).length;

        planes.clearLayers();
        L.geoJson(data, myLayerOptions).addTo(planes);
      });

      $.getJSON("/turb.geojson", function (data) {
        turbulences.clearLayers();
        L.geoJson(data, {
          onEachFeature: onEachTurb,
        }).addTo(turbulences);
      });
    },
    interval: 4000,
  })
  .addTo(map)
  .startUpdating();

L.control.scale().addTo(map);
L.control.layers(null, overlays).addTo(map);
map.addLayer(baselayer);
