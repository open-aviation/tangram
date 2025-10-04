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
      "track",
      "vertical_rate",
      "bds50",
      "bds60",
    ])
    .derive({
      timestamp: aq.escape((x) => 1000 * x.timestamp),
      callsign: aq.op.fill_down("callsign"),
      TAS: aq.escape((x) => x.bds50?.TAS),
      roll: aq.escape((x) => x.bds50?.roll),
      heading: aq.escape((x) => x.bds60?.heading),
      IAS: aq.escape((x) => x.bds60?.IAS),
      vrate_barometric: aq.escape((x) => x.bds60?.vrate_barometric),
      vrate_inertial: aq.escape((x) => x.bds60?.vrate_inertial),
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
