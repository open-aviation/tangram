var myChart;
async function get_data(icao, chart_history) {
  url = "chart.data/" + icao;
  const searchParams = new URLSearchParams({ history: chart_history });
  url = url + "?" + searchParams;
  var a = await $.getJSON(url);
  return a;
}
async function draw_chart(icao, chart_history = 0) {
  var result = await get_data(icao, chart_history);
  var data = {
    labels: result[0],
    datasets: [
      {
        type: "scatter",
        label: "turbulence",
        data: result[1],
        fill: false,
        borderColor: "rgb(192, 0, 0)",
      },
      {
        type: "line",
        label: "vsi",
        data: result[2],
        fill: false,
        borderColor: "rgb(0, 192, 0)",
        pointRadius: 1,
      },
      {
        type: "line",
        label: "vsb",
        data: result[3],
        fill: false,
        borderColor: "rgb(0, 0, 192)",
        pointRadius: 1,
      },
      {
        type: "scatter",
        label: "criterion",
        data: result[4],
        fill: false,
        borderColor: "rgb(0, 100, 100)",
        pointRadius: 1,
      },
      {
        type: "line",
        label: "threshold",
        data: result[5],
        fill: false,
        borderColor: "rgb(100, 100, 0)",
        pointRadius: 1,
      },
      {
        type: "scatter",
        label: "altitude",
        data: result[6],
        fill: false,
        borderColor: "rgb(211, 149, 237)",
        pointRadius: 1,
        hidden: true,
      },
      {
        type: "line",
        label: "vsi_std",
        data: result[7],
        fill: false,
        borderColor: "rgb(255, 204, 229)",
        pointRadius: 1,
        hidden: true,
      },
      {
        type: "line",
        label: "vsb_std",
        data: result[8],
        fill: false,
        borderColor: "rgb(153, 255, 255)",
        pointRadius: 1,
        hidden: true,
      },
    ],
  };
  var config = {
    type: "line",
    data: data,
    options: {
      responsive: true,
      scales: {
        xAxes: [
          {
            type: "time",
            timezone: "UTC",
          },
        ],
      },
      // plugins: {
      //   zoom: {
      //     pan: {
      //       enabled: true,
      //     },
      //     // Container for zoom options
      //     zoom: {
      //       // Boolean to enable zooming
      //       enabled: true,

      //       // Enable drag-to-zoom behavior
      //       wheel: {
      //         enabled: false,
      //       },

      //       pinch: {
      //         enabled: true
      //       },
      //       // Drag-to-zoom effect can be customized
      //       // drag: {
      //       // 	 borderColor: 'rgba(225,225,225,0.3)'
      //       // 	 borderWidth: 5,
      //       // 	 backgroundColor: 'rgb(225,225,225)',
      //       // 	 animationDuration: 0
      //       // },

      //       // Zooming directions. Remove the appropriate direction to disable
      //       // Eg. 'y' would only allow zooming in the y direction
      //       // A function that is called as the user is zooming and returns the
      //       // available directions can also be used:
      //       //   mode: function({ chart }) {
      //       //     return 'xy';
      //       //   },
      //       mode: 'xy',

      //       rangeMin: {
      //         // Format of min zoom range depends on scale type
      //         x: null,
      //         y: null
      //       },
      //       rangeMax: {
      //         // Format of max zoom range depends on scale type
      //         x: null,
      //         y: null
      //       },

      //       // Speed of zoom via mouse wheel
      //       // (percentage of zoom on a wheel event)
      //       speed: 0.1,

      //       // Minimal zoom distance required before actually applying zoom
      //       threshold: 2,

      //       // On category scale, minimal zoom level before actually applying zoom
      //       sensitivity: 3,
      //     }
      //   }
      // }
    },
  };
  if (myChart != undefined || myChart != null) {
    myChart.destroy();
  }
  document.getElementById("myChart").style.display = "block";
  var context = document.getElementById("myChart").getContext("2d");
  myChart = new Chart(context, config);
}
