var myChart;
async function get_data(icao) {
  var a = await $.getJSON("/chart.data/" + icao);
  return a;
}
async function draw_chart(icao) {
  var result = await get_data(icao);
  var data = {
    datasets: [
      {
        type: "scatter",
        label: "turbulence",
        data: result[0],
        fill: false,
        borderColor: "rgb(192, 0, 0)",
      },
      {
        type: "line",
        label: "vsi",
        data: result[1],
        fill: false,
        borderColor: "rgb(0, 192, 0)",
      },
      {
        type: "line",
        label: "vsb",
        data: result[2],
        fill: false,
        borderColor: "rgb(0, 0, 192)",
      },
      {
        type: "line",
        label: "criterion",
        data: result[3],
        fill: false,
        borderColor: "rgb(0, 100, 100)",
      },
      {
        type: "line",
        label: "threshold",
        data: result[4],
        fill: false,
        borderColor: "rgb(100, 100, 0)",
      },
    ],
  };
  var config = {
    type: "line",
    data: data,
    options: {
      scales: {
        xAxes: [
          {
            type: "time",
          },
        ],
      },
    },
    plugins: {
      title: {
        display: true,
        text: JSON.stringify(icao),
      },
    },
  };
  if (myChart != undefined || myChart != null) {
    myChart.destroy();
  }
  document.getElementById("myChart").style.display = "block";
  var context = document.getElementById("myChart").getContext("2d");
  myChart = new Chart(context, config);
}
