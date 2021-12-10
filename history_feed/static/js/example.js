var map = L.map("map", {
  zoom: 10,
  center: [38.705, 1.15],
  timeDimension: true,
  timeDimensionOptions: {
    timeInterval: "2014-09-30/2014-10-30",
    period: "PT1H",
  },
  timeDimensionControl: true,
});

// var wmsUrl =
//   "https://thredds.socib.es/thredds/wms/observational/hf_radar/hf_radar_ibiza-scb_codarssproc001_aggregation/dep0001_hf-radar-ibiza_scb-codarssproc001_L1_agg.nc";
// var wmsLayer = L.tileLayer.wms(wmsUrl, {
//   layers: "sea_water_velocity",
//   format: "image/png",
//   transparent: true,
//   attribution: "SOCIB HF RADAR | sea_water_velocity",
// });

// // Create and add a TimeDimension Layer to the map
// var tdWmsLayer = L.timeDimension.layer.wms(wmsLayer);
// tdWmsLayer.addTo(map);
