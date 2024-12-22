async function draw_chart(icao, columns) {
  var data = aq
    .from(await $.getJSON("data/" + icao), [
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
      /*track: aq.escape((d) => {
        let prevAngle = 0;
        return d.track.map((angle) => {
          const unwrapped = unwrapAngle(prevAngle, angle);
          prevAngle = unwrapped;
          return unwrapped;
        });
      }),*/
    })
    .orderby(aq.desc("timestamp"));
  var flight = new traffic.Flight(data);
  // TODO traffic.js
  // flight = flight.resample(d3.timeSecond.every(1));
  var plot = Plot.plot({
    marks: [
      Plot.line(flight.data.fold(columns, { as: ["key", "value"] }), {
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
  $("#chart").html(plot);
}
