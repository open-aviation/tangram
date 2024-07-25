const CHART_SELECTOR = "#chart";
const PLOT_SELECTOR = "#plot-select";


function whenFeatureSelected() {
  let icao24 = $("#icao24").text();
  let feat = $("#plot-select").val()
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

function draw_chart_data(selector, raw_data, columns) {
  var data = aq // arquero
    .from(raw_data, [
      "timestamp",
      "icao24",
      "callsign",
      "latitude",
      "longitude",
      "altitude",
      "selected_altitude",
      "groundspeed",
      "TAS",
      "IAS",
      "track",
      "heading",
      "roll",
      "vertical_rate",
      "vrate_barometric",
      "vrate_inertial",
    ])
    .derive({
      timestamp: aq.escape((x) => 1000 * x.timestamp),
      callsign: aq.op.fill_down("callsign"),
      // TODO traffic.js
      // track: aq.escape((d) => {
      //   let prevAngle = 0;
      //   return d.track.map((angle) => {
      //     const unwrapped = unwrapAngle(prevAngle, angle);
      //     prevAngle = unwrapped;
      //     return unwrapped;
      //   });
      // }),
    })
    .orderby(aq.desc("timestamp"));
  console.dir(data);

  var flight = new traffic.Flight(data);
  // TODO traffic.js
  // flight = flight.resample(d3.timeSecond.every(1));

  let line_data = flight.data.fold(columns, { as: ["key", "value"] });
  console.dir(line_data);

  // https://observablehq.com/plot
  var plot = Plot.plot({
    marks: [
      Plot.line(line_data, {
        x: "timestamp",
        y: "value",
        stroke: "key",
        strokeOpacity: 0.8,
        curve: "linear",
      }),
    ],
    x: {
      tickFormat: d3.utcFormat("%H:%M"),
    },
    marginLeft: 50,
    width: 500,
    height: 200,
    grid: true,
    style: {
      background: "transparent",
    },
    color: {
      legend: true,
    },
  });

  $(selector).html(plot);
}

async function draw_chart(icao, columns) {
  console.log(`draw chart ${icao}, columns: ${columns}`);
  let raw_data = await $.getJSON(`/data/${icao}`);
  draw_chart_data('#chart', raw_data, columns);
}


// NOTE: THIS DOES NOT WORK
//
// function leave_chart_channel(channel_name) {
//   console.log(`leaving trajectory channel ${channel_name}`);
//   chart_channel
//     .leave() // Push
//     .receive('ok', () => {
//       chart_channel = null;
//       console.log(`left channel ${channel_name}`, chart_channel);
//     })
// }
//
// function join_chart_channel(selected_icao24) {
//   let channel_name = `channel:chart:${selected_icao24}`;
//   console.log(`joining channel ${channel_name}`);
//
//   chart_channel = socket.channel(channel_name, { token: 'okToJoin' }); // no joining token required
//
//   chart_channel.on('chart-update', (data) => {
//     // update chart
//     let feat = $("#plot-select").val();
//     console.log(`feat: ${feat}, data: `, data);
//     switch (feat) {
//       case "speed":
//         draw_chart_data('#chart', data, ["groundspeed", "IAS", "TAS"]);
//         break;
//       case "vertical_rate":
//         draw_chart_data('#chart', data, ["vrate_barometric", "vrate_inertial", "vertical_rate"]);
//         break;
//       case "track":
//         draw_chart_data('#chart', data, ["track", "heading", "roll"]);
//         break;
//       case "altitude":
//       default:
//         draw_chart_data('#chart', data, ["altitude", "selected_altitude"]);
//         break;
//     }
//   });
//
//   chart_channel
//     .join()
//     .receive("ok", ({ messages }) => {
//       console.log(`(${channel_name}) joined`, messages);
//     })
//     .receive("error", ({ reason }) =>
//       console.log(`failed to join ${channel_name}`, reason)
//     )
//     .receive("timeout", () => console.log(`timeout joining ${channel_name}`));
// }
