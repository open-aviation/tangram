var chart_history;
var selected = null;
function getFlight_data(icao24, callsign, tail, typecode) {
  document.getElementById("icao24").innerHTML = icao24;
  document.getElementById("typecode").innerHTML = typecode;
  document.getElementById("tail").innerHTML = tail;
  var aircraft_id = document.getElementById("aircraft_id");
  aircraft_id.innerHTML = callsign;
  url = "context/flight/" + icao24;
  $.getJSON(url, function (data) {
    flight_id = document.getElementById("flight_id");
    departure = document.getElementById("departure");
    destination = document.getElementById("destination");

    if (data.flightId === undefined) {
      flight_id.innerHTML = "";
      departure.innerHTML = "";
      destination.innerHTML = "";
    } else {
      flight_id.innerHTML = data.flightId.id;
      departure.innerHTML = data.flightId.keys.aerodromeOfDeparture;
      destination.innerHTML = data.flightId.keys.aerodromeOfDestination;
      aircraft_id.innerHTML = data.flightId.keys.aircraftId;
    }
  });
  document.getElementById("flight").hidden = false;
}
function deselect_planes() {
  document.getElementById("chart-pane").style.display = "none";
  traj.clearLayers();
  $(".aircraft_selected").toggleClass("aircraft_img", true);
  $(".aircraft_selected").toggleClass("aircraft_selected", false);
  $(".turb_selected").toggleClass("turb_path", true);
  $(".turb_selected").toggleClass("turb_selected", false);
  selected = "";
}
function whenClicked(e) {
  deselect_planes();
  document.getElementById("chart-pane").style.display = "block";
  var icao24 = e.target.feature.properties.icao24;
  var callsign = e.target.feature.properties.callsign;
  var typecode = e.target.feature.properties.typecode || "";
  var tail = e.target.feature.properties.registration || "";
  selected = icao24;
  $("#" + icao24).toggleClass("aircraft_img", false);
  $("#" + icao24).toggleClass("aircraft_selected", true);
  $(".turb-" + icao24).toggleClass("turb_path", false);
  $(".turb-" + icao24).toggleClass("turb_selected", true);

  getTrajectory(icao24, (history = chart_history));
  getFlight_data(icao24, callsign, tail, typecode);

  sidebar.open("info_box");

  let feat = $("#plot_select").val();
  whenFeatureSelected(feat);
}
function whenFeatureSelected(feat) {
  let icao24 = $("#icao24").text();
  switch (feat) {
    case "speed":
      draw_chart(icao24, ["groundspeed", "IAS", "TAS"]);
      break;
    case "vertical_rate":
      draw_chart(icao24, [
        "vrate_barometric",
        "vrate_inertial",
        "vertical_rate",
      ]);
      break;
    case "track":
      draw_chart(icao24, ["track", "heading", "roll"]);
      break;
    case "altitude":
    default:
      draw_chart(icao24, ["altitude", "selected_altitude"]);
      break;
  }
}
function onEachPlane(feature, layer) {
  let icao24 = feature.properties.icao24;
  if (icao24 === selected) {
    getTrajectory(icao24, chart_history);
  }
  var popupContent =
    `<p>` +
    `icao24: <code>${icao24}</code><br/>` +
    `callsign: <code>${feature.properties.callsign}</code><br/>` +
    `tail: <code>${feature.properties.registration}</code><br/>` +
    `altitude: <code>${feature.properties.altitude}</code><br/>` +
    `</p>`;

  layer.bindPopup(popupContent);
  layer.on({
    click: whenClicked,
  });
  layer.on({
    mouseover: function (e) {
      this.openPopup();
    },
  });
  layer.on({
    mouseout: function (e) {
      this.closePopup();
    },
  });
}
function onEachTurb(feature, layer) {
  layer.on({
    click: whenClicked,
  });
}
function planeInfo(data) {
  var avion = document.getElementById("plane_count");
  avion.innerHTML = data.count;

  planes.clearLayers();

  let arr = data
    .filter((item) => !(item.longitude === null && item.latitude === null))
    .map((item) => {
      return {
        type: "Feature",
        properties: item,
        geometry: {
          type: "Point",
          coordinates: [item.longitude, item.latitude],
        },
      };
    });
  var geojson = {
    name: "state_vectors",
    type: "FeatureCollection",
    features: arr,
  };
  L.geoJson(geojson, {
    onEachFeature: onEachPlane,
    pointToLayer: createCustomIcon,
  }).addTo(planes);
}

function onEachAirep(feature, layer) {
  var popupContent =
    "<p>callsign: " +
    feature.properties.callsign +
    "<br>icao24: " +
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
  var iconProps = get_image_object(
    feature.properties.typecode,
    feature.properties.callsign
  );
  var bbox = Raphael.pathBBox(iconProps.path);
  var x = Math.floor(bbox.x + bbox.width / 2.0);
  var y = Math.floor(bbox.y + bbox.height / 2.0);
  var center = { x: x, y: y };
  offs_x = 0;
  if (iconProps.ofX) {
    offs_x = iconProps.ofX;
  }
  offs_y = 0;
  if (iconProps.ofY) {
    offs_y = iconProps.ofY;
  }
  var transform =
    "T" +
    (-1 * center.x + offs_x) +
    "," +
    (-1 * center.y + offs_y) +
    "S" +
    iconProps.scale * 0.7;
  var newPath = Raphael.mapPath(
    iconProps.path,
    Raphael.toMatrix(iconProps.path, transform)
  );

  // recalculate bounding box
  // var object_box = Raphael.pathBBox(newPath);
  // use a viewbox that has its top left point at the top left point of the geometry's bounding box
  // as specified by the google maps js api, a symbol has to fit a 32x32 coordinate system, hence the size
  var viewBox = 'viewBox="' + [-16, -16, 32, 32].join(" ") + '"';
  var svgDynProps = {
    stroke: "#0014aa",
    strokeWdt: 0.65,
  };

  var generateSvgString = function (addition) {
    var pathplain =
      "<path stroke=" +
      svgDynProps.stroke +
      " stroke-width=" +
      svgDynProps.strokeWdt +
      " d=" +
      newPath +
      "/>";
    var svgplain =
      '<svg id="' +
      feature.properties.icao24 +
      '"version="1.1" shape-rendering="geometricPrecision" width="32px" height="32px" ' +
      viewBox +
      ' xmlns="http://www.w3.org/2000/svg">' +
      pathplain +
      "</svg>";
    return svgplain;
  };
  let myIcon = L.divIcon({
    html: generateSvgString(""),
    className:
      feature.properties.icao24 != selected
        ? "aircraft_img"
        : "aircraft_selected",
    iconSize: [33, 35], // width and height of the image in pixels
    iconAnchor: [16.5, 17.5], // point of the icon which will correspond to marker's location
    popupAnchor: [0, 0], // point from which the popup should open relative to the iconAnchor
  });
  let marker = L.marker(latlng, {
    icon: myIcon,
    rotationAngle: (feature.properties.track + iconProps.rotcorr) % 360,
  });
  return marker;
}
function getSigmet(wef = null, und = null) {
  var url = "context/sigmet";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + "?" + searchParams;
  }
  var sigmet;
  $.getJSON(url, function (data) {
    if (data.features == undefined) {
      data["features"] = {};
    }
    document.getElementById("sigmet_count").innerHTML = Object.keys(
      data.features
    ).length;
    sigmet = data;
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
function getAirep(wef = null, und = null) {
  url = "context/airep";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + "?" + searchParams;
  }
  var airep;
  $.getJSON(url, function (data) {
    if (data.features == undefined) {
      data["features"] = {};
    }
    document.getElementById("airep_count").innerHTML = Object.keys(
      data.features
    ).length;
    airep = data;
    aireps.clearLayers();
    L.geoJson(data, {
      onEachFeature: onEachAirep,
    }).addTo(aireps);
  });
  return airep;
}
function getCat(wef = null, und = null) {
  url = "context/cat";
  if ((wef !== null) & (und !== null)) {
    const searchParams = new URLSearchParams({ wef: wef, und: und });
    url = url + "?" + searchParams;
  }
  var cat;
  $.getJSON(url, function (data) {
    cat_sev.clearLayers();
    cat_mod.clearLayers();
    if ($.isEmptyObject(data)) {
      return;
    }
    cat = data;
    L.geoJson(data, {
      filter: function (feature) {
        return feature.properties.intensityValue == 2;
      },
      style: function () {
        return { color: "red", opacity: 0 };
      },
      onEachFeature: onEachCat,
    }).addTo(cat_sev);
    L.geoJson(data, {
      filter: function (feature) {
        return feature.properties.intensityValue == 1;
      },
      style: function () {
        return { color: "gray", opacity: 0 };
      },
      onEachFeature: onEachCat,
    }).addTo(cat_mod);
  });
  return cat;
}
function getPlanes(und = "", history = 0, icao24 = "", callsign = "") {
  url = "planes.geojson";
  const searchParams = new URLSearchParams({
    history: history,
    und: und,
    icao24: icao24,
    callsign: callsign,
  });
  url = url + "?" + searchParams;

  $.getJSON(url, function (data) {});
}

function getTurbulence(und = "", history = 0, icao24 = "", callsign = "") {
  url = "turb.geojson";
  const searchParams = new URLSearchParams({
    history: history,
    und: und,
    icao24: icao24,
    callsign: callsign,
  });
  url = url + "?" + searchParams;

  var turbu;
  $.getJSON(url, function (data) {
    turbu = data;
    turbulences.clearLayers();
    var turb_geojson = L.geoJson(data.geojson, {
      onEachFeature: onEachTurb,
      style: function (feature) {
        var icao24 = feature.geometry.properties.icao24;
        var intensity = feature.geometry.properties.intensity;
        var color = function () {
          return intensity >= 200
            ? "#8400ff"
            : (intensity < 200) & (intensity > 100)
            ? "#ff9900"
            : "#0084ff";
        };
        if (icao24 === selected) {
          return { className: "turb_selected turb-" + icao24, color: color() };
        }
        return { className: "turb_path turb-" + icao24, color: color() };
      },
      // function (feature) {
      //   var icao = feature.properties.icao;
      //   return icao == selected
      //     ? { className: "turb_selected" }
      //     : {
      //       className: "turb_path"
      //     };
      // }
    }).addTo(turbulences);
    heatm = data.geojson.features;
    var values = [];
    var res = [];
    heatm.forEach(function (key) {
      for (var i = 0, l1 = key.coordinates.length; i < l1; i++) {
        key.coordinates[i][3] = key.properties.intensity;
        res.push(key.coordinates[i]);
      }
      // values.push(Object.values());
    });

    hexLayer.data(res);
    // turb_geojson.eachLayer(function (layer) {
    //   layer._path.id = 'turb-' + layer.feature.geometry.properties.icao;
    // });
  });
  return turbu;
}
function getheatmap(und = null, history = 0) {
  url = "heatmap.data";
  if (und !== null) {
    url = url + "/" + und;
  }
  if (history) {
    const searchParams = new URLSearchParams({ history: history });
    url = url + "?" + searchParams;
  }
  var heatm;
  $.getJSON(url, function (data) {
    heatm = data.data;
    hexLayer.data(heatm);
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
  } else {
    hours = date.getUTCHours();
    minutes = date.getUTCMinutes();
  }

  if (hours < 10) {
    hours = "0" + hours;
  }
  if (minutes < 10) {
    minutes = "0" + minutes;
  }

  var zeit_string = hours + ":" + minutes;

  return zeit_string;
}
function getTrajectory(icao24) {
  url = "trajectory/" + icao24;
  $.getJSON(url, function (data) {
    traj.clearLayers();
    L.geoJson(data, {
      color: "black",
    }).addTo(traj);
  });
}
