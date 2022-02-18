function getFlight_data(icao) {
  document.getElementById("icao").innerHTML = icao;
  url = "/flight/" + icao
  $.getJSON(url, function (data) {
    document.getElementById("flight_id").innerHTML = (data.flightId.id != undefined) ? (data.flightId.id) : ("");
    document.getElementById("departure").innerHTML = (data.flightId.keys.aerodromeOfDeparture != undefined) ? (data.flightId.keys.aerodromeOfDeparture) : ("");
    document.getElementById("destination").innerHTML = (data.flightId.keys.aerodromeOfDestination != undefined) ? (data.flightId.keys.aerodromeOfDestination) : ("");
    document.getElementById("aircraft_id").innerHTML = (data.flightId.keys.aircraftId != undefined) ? (data.flightId.keys.aircraftId) : ("");
  });
  document.getElementById("flight").hidden = false;
}

function whenClicked(e) {
  // var match = planes.eachLayer(function (layer) {
  //   if (layer.feature.properties.icao == "a4b827") {
  //     return layer.feature.properties.icao
  //   }
  // })
  // document.getElementById("airep_count").innerHTML = match;
  draw_chart(e.target.feature.properties.icao);
  getFlight_data(e.target.feature.properties.icao);
  // var $layer = e.target;
  // var highlightStyle = {
  //   color: "red",
  //   opacity: 10,
  //   weight: 50,
  // };
  // $layer.bringToFront();
  // $layer.setStyle(highlightStyle);
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
function getSigmet(wef = null, und = null) {
  var url = "/sigmet.geojson";
  if ((wef !== null) & (und !== null)) {
    url = url + "/" + wef + "," + und;
  }

  $.getJSON(url, function (data) {
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
}
function getAirep(wef = null, und = null) {
  url = "/airep.geojson";
  if ((wef !== null) & (und !== null)) {
    url = url + "/" + wef + "," + und;
  }
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
    aireps.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachAirep,
    }).addTo(aireps);
  });
}
function getCat(wef = null, und = null) {
  url = "/cat.geojson";
  if ((wef !== null) & (und !== null)) {
    url = url + "/" + wef + "," + und;
  }
  $.getJSON(url, function (data) {
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
function getPlanes(und = null) {
  url = "/planes.geojson"
  if (und !== null) {
    url = url + "/" + und
  }
  $.getJSON(url, function (data) {
    var avion = document.getElementById("plane_count");
    avion.innerHTML = Object.keys(data.features).length;

    planes.clearLayers();
    L.geoJson(data, myLayerOptions).addTo(planes);
  });
}
function getTurbulence(und = null) {
  url = "/turb.geojson"
  if (und !== null) {
    url = url + "/" + und
  }
  $.getJSON(url, function (data) {
    turbulences.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachTurb,
    }).addTo(turbulences);
  });
}