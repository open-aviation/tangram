var chart_history;

function renderPlanes(data) {
  // document.getElementById("plane_count").innerHTML = data.items.length;

  planes.clearLayers();

  let features = data
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

  L
    .geoJson(
      { name: "state_vectors", type: "FeatureCollection", features },
      { onEachFeature: onEachPlane, pointToLayer: createCustomIcon },
    )
    .addTo(planes);
}

function onEachPlane(feature, layer) {
  let icao24 = feature.properties.icao24;
  // if (icao24 === selected.icao24) {
  // getAndDrawTrajectory(icao24, chart_history);
  // }
  var popupContent =
    `<p> ` +
    `icao24: <code>${icao24}</code><br/>` +
    `callsign: <code>${feature.properties.callsign}</code><br/>` +
    `tail: <code>${feature.properties.registration}</code><br/>` +
    `altitude: <code>${feature.properties.altitude}</code><br/>` +
    `</p> `;

  layer.bindPopup(popupContent);
  layer.on({ click: onPlaneClicked });
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
      feature.properties.icao24 != selected.icao24
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

function onPlaneClicked(e) {
  deselect_planes();
  document.getElementById("chart-pane").style.display = "block";
  var icao24 = e.target.feature.properties.icao24;
  var callsign = e.target.feature.properties.callsign;
  var typecode = e.target.feature.properties.typecode || "";
  var tail = e.target.feature.properties.registration || "";
  selected.icao24 = icao24;
  console.log(`plane [${selected.icao24}] selected`);

  joinTrajectoryChannel(`channel:trajectory:${selected.icao24}`);

  $("#" + icao24).toggleClass("aircraft_img", false);
  $("#" + icao24).toggleClass("aircraft_selected", true);
  $(".turb-" + icao24).toggleClass("turb_path", false);
  $(".turb-" + icao24).toggleClass("turb_selected", true);

  draw_chart(icao24, chart_history);
  document.getElementById("chart-pane").style.display = "block";

  getAndDrawTrajectory(icao24, (history = chart_history));
  getFlight_data(icao24, callsign, tail, typecode);

  sidebar.open("info_box");

  let feat = $("#plot_select").val();
  whenFeatureSelected(feat);
}

function deselect_planes() {
  console.log(`deselect plan ${selected.icao24}`, trajectoryChannel);
  if (trajectoryChannel !== null) {
    leaveTrajectoryChannel(`channel:trajectory:${selected.icao24}`)
  }

  document.getElementById("chart-pane").style.display = "none";
  traj.clearLayers();
  $(".aircraft_selected").toggleClass("aircraft_img", true);
  $(".aircraft_selected").toggleClass("aircraft_selected", false);
  $(".turb_selected").toggleClass("turb_path", true);
  $(".turb_selected").toggleClass("turb_selected", false);

  selected.icao24 = null;
}




function whenFeatureSelected(feat) {
  let icao24 = $("#icao24").text();
  switch (feat) {
    case "speed":
      draw_chart(icao24, ["groundspeed", "IAS", "TAS"]);
      break;
    case "vertical_rate":
      draw_chart(icao24, ["vrate_barometric", "vrate_inertial", "vertical_rate"]);
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

