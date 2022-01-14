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
function getPlanes() {
  $.getJSON("/planes.geojson", function (data) {
    planes.clearLayers();
    L.geoJson(data, myLayerOptions).addTo(planes);
  });
}
getPlanes();
function getTurbulence() {
  $.getJSON("/turb.geojson", function (data) {
    turbulences.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachTurb,
    }).addTo(turbulences);
  });
}
getTurbulence();
function getSigmet(wef = null, und = null) {
  var url = "/sigmet.geojson";
  if ((wef !== null) & (und !== null)) {
    url = url + "/" + wef + "," + und;
  }
  sigmets.clearLayers();
  $.getJSON(url, function (data) {
    loadTable(
      "table_sigmet",
      ["idSigmet", "hazard", "validTimeFrom", "validTimeTo", "firName"],
      data["features"]
    );
    document.getElementById("sigmet_count").innerHTML = Object.keys(
      data.features
    ).length;

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
}
getSigmet();
function getAirep(wef = null, und = null) {
  url = "/airep.geojson";
  if ((wef !== null) & (und !== null)) {
    url = url + "/" + wef + "," + und;
  }
  aireps.clearLayers();
  $.getJSON(url, function (data) {
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

    L.geoJson(data, {
      onEachFeature: onEachAirep,
    }).addTo(aireps);
  });
}
getAirep();
function getCat() {
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
}
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
