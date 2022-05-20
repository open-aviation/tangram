var chart_history;
function getFlight_data(icao, callsign, typecode) {
  document.getElementById("icao").innerHTML = icao;
  document.getElementById('typecode').innerHTML = typecode;
  var aircraft_id = document.getElementById('aircraft_id');
  aircraft_id.innerHTML = callsign;
  url = "context/flight/" + icao
  $.getJSON(url, function (data) {
    flight_id = document.getElementById('flight_id');
    departure = document.getElementById('departure');
    destination = document.getElementById('destination');

    if (data.flightId === undefined) {
      flight_id.innerHTML = ""; departure.innerHTML = ""; destination.innerHTML = "";
    } else {
      flight_id.innerHTML = data.flightId.id;
      departure.innerHTML = data.flightId.keys.aerodromeOfDeparture;
      destination.innerHTML = data.flightId.keys.aerodromeOfDestination;
      aircraft_id.innerHTML = data.flightId.keys.aircraftId;
    }
  });
  document.getElementById("flight").hidden = false;
}

function whenClicked(e) {
  var icao = (e.target.feature.properties.icao === undefined) ? (e.target.feature.geometry.properties.icao) : e.target.feature.properties.icao
  var callsign = (e.target.feature.properties.callsign === undefined) ? (e.target.feature.geometry.properties.callsign) : e.target.feature.properties.callsign
  var typecode = (e.target.feature.properties.typecode === undefined) ? (e.target.feature.geometry.properties.typecode) : e.target.feature.properties.typecode
  draw_chart(icao, chart_history);
  getFlight_data(icao, callsign, typecode);
  sidebar.open("info_box");
}
function onEachPlane(feature, layer) {
  var popupContent = "<p>ICAO: " + feature.properties.icao + "<br>Callsign: " + feature.properties.callsign + "</p>";

  layer.bindPopup(popupContent);
  layer.on({
    click: whenClicked,
  });
}
function onEachTurb(feature, layer) {
  var popupContent = "<p>ICAO: " + feature.properties.icao + "<br>Callsign: " + feature.properties.callsign + "</p>";
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
    "<br>Altitude: " +
    feature.properties.altitude +
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
// html: "<svg  version='1' xmlns='http://www.w3.org/2000/svg' width='" + width_height + "' height='" + width_height + "' viewBox='0 0 " + box + " " + box + "'><path d='" + imageObj.path + "' fill='#f9fd15' stroke='#0014aa' stroke-width='1'></path></svg > ",
function createCustomIcon2(feature, latlng) {
  var imageObj = get_image_object(feature.properties.typecode)
  var svg = "<svg xmlns='http://www.w3.org/2000/svg' version='1.0' viewBox='0 0 64 64' width='100%' height='100%'><g transform='scale(" + imageObj.scale + ")'><path id='" + feature.properties.icao + "' d='" + imageObj.path + "' fill='#f9fd15' stroke='#0014aa' stroke-width='1'></path></g></svg >";
  var iconUrl = 'data:image/svg+xml;base64,' + btoa(svg);

  var myIcon = L.icon({
    iconUrl: iconUrl,
    iconSize: [40, 40], // width and height of the image in pixels
    iconAnchor: [12, 12], // point of the icon which will correspond to marker's location
    popupAnchor: [0, 0],
  });
  // let myIcon = L.divIcon({
  //   html: " ",
  //   className: "aircraft_img",
  //   iconSize: [35, 37], // width and height of the image in pixels
  //   iconAnchor: [12, 12], // point of the icon which will correspond to marker's location
  //   popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
  // });
  return L.marker(latlng, {
    icon: myIcon,
    rotationAngle: (feature.properties.dir + imageObj.rotcorr) % 360,
  });
}
function updateTableSigmet(data) {
  loadTable(
    "table_sigmet",
    ["idSigmet", "hazard", "validTimeFrom", "validTimeTo", "firName"],
    data["features"]
  );
  document.getElementById("sigmet_count").innerHTML = Object.keys(
    data.features
  ).length;
}
function getSigmet(wef = null, und = null) {
  var url = "context/sigmet";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + '?' + searchParams;
  }
  var sigmet;
  $.getJSON(url, function (data) {
    if (data.features == undefined) {
      data["features"] = {}
    }
    sigmet = data
    updateTableSigmet(data)
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
  return sigmet;
}
function updateTableAirep(data) {
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
}
function getAirep(wef = null, und = null) {
  url = "context/airep";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + '?' + searchParams;
  }
  var airep;
  $.getJSON(url, function (data) {
    if (data.features == undefined) {
      data["features"] = {}
    }
    updateTableAirep(data);
    airep = data
    aireps.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachAirep,
    }).addTo(aireps);
  });
  return airep
}
function getCat(wef = null, und = null) {
  url = "context/cat";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + '?' + searchParams;
  }
  var cat;
  $.getJSON(url, function (data) {
    cat_sev.clearLayers();
    cat_mod.clearLayers();
    if ($.isEmptyObject(data)) {
      return
    }
    cat = data;
    L.geoJson(data, {
      filter: function (feature) {
        return feature.properties.intensityValue == 2
      },
      style: function () {
        return { color: "red", opacity: 0 }
      },
      onEachFeature: onEachCat,
    }).addTo(cat_sev);
    L.geoJson(data, {
      filter: function (feature) {
        return feature.properties.intensityValue == 1
      },
      style: function () {
        return { color: "gray", opacity: 0 }
      },
      onEachFeature: onEachCat,
    }).addTo(cat_mod);
  });
  return cat;
}
function getPlanes(und = "", history = 0, icao24 = "", callsign = "") {
  url = "planes.geojson"
  const searchParams = new URLSearchParams({ history: history, und: und, icao24: icao24, callsign: callsign });
  url = url + '?' + searchParams

  $.getJSON(url, function (data) {
    var avion = document.getElementById("plane_count");
    avion.innerHTML = data.count;

    planes.clearLayers();
    L.geoJson(data.geojson, myLayerOptions).addTo(planes);
  });
}
function getTurbulence(und = "", history = 0, icao24 = "", callsign = "") {
  url = "turb.geojson"
  const searchParams = new URLSearchParams({ history: history, und: und, icao24: icao24, callsign: callsign });
  url = url + '?' + searchParams

  var turbu;
  $.getJSON(url, function (data) {
    turbu = data
    turbulences.clearLayers();
    L.geoJson(data.geojson, {
      onEachFeature: onEachTurb,
    }).addTo(turbulences);
  });
  return turbu;
}
function getheatmap(und = null, history = 0) {
  url = "heatmap.data"
  if (und !== null) {
    url = url + "/" + und
  }
  if (history) {
    const searchParams = new URLSearchParams({ history: history });
    url = url + '?' + searchParams
  }
  var heatm;
  $.getJSON(url, function (data) {
    heatm = data.data;
    heatmapLayer.clearLayers();
    L.heatLayer(data.data, { radius: 25 }).addTo(heatmapLayer);
  });
  return heatm;
}
function getTimeString(isLocal) {
  var hours;
  var minutes;
  var date = new Date();

  if (isLocal) {
    hours = date.getHours();
    minutes = date.getMinutes();
  }
  else {
    hours = date.getUTCHours();
    minutes = date.getUTCMinutes();
  }

  if (hours < 10) { hours = '0' + hours; }
  if (minutes < 10) { minutes = '0' + minutes; }

  var zeit_string = hours + ':' + minutes;

  return zeit_string;
}
// function highlightTrajectory(e) {
//   var layer = e.target;
//   layer.setStyle({
//     weight: 4,
//     opacity: 1,
//     color: "#dbff4d",
//   });
//   layer.bringToFront();
// }

// //reset the hightlighted states on mouseout
// function resetTrajectory(e) {
//   geojsonStates.resetStyle(e.target);
// }


// //add these events to the layer object
// function onEachTrajectory(feature, layer) {
//   layer.on({
//     click: highlightTrajectory,
//     mouseout: resetTrajectory,
//   });
// }

// function getTrajectory(icao) {
//   $.getJSON(url, function (data) {
//     traj.clearLayers();
//     L.geoJson(data, {
//       onEachFeature: onEachTrajectory,
//     }).addTo(traj);
//   });
// }