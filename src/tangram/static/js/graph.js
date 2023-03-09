var myChart;
async function get_data(icao, chart_history) {
  url = "chart.data/" + icao;
  const searchParams = new URLSearchParams({ history: chart_history });
  url = url + "?" + searchParams;
  var a = await $.getJSON(url);
  return a;
}
async function draw_chart(icao, chart_history = 0) {
  var data = aq.table(await get_data(icao, chart_history));
  data = data.fold(["turb", "vsi", "vsb", "cri", "thr"], {
    as: ["key", "value"],
  });
  var res = data.objects();
  var options = {
    style: {
      background: "transparent",
    },
    color: {
      legend: true,
    },
    // set y axis options
    x: { type: "utc", domain: [res[0]["ts"], res[res.length - 1]["ts"]] },
    y: {
      grid: false,
    },
    // define the marks we will use, dots and and a line
    marks: [
      Plot.lineY(res, {
        x: "ts",
        y: "value",
        stroke: "key",
      }),
    ],
  };
  // Draw the plot
  $("#Chart").html("");

  document.getElementById("Chart").append(Plot.plot(options));

  // var context = document.getElementById("myChart").getContext("2d");
  // myChart = new Chart(context, config);
}
