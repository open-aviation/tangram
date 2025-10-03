<template>
  <div class="wind-altitude-control" @mousedown.stop @touchstart.stop>
    <label for="hpa-slider">{{ isobaric }}hPa | FL{{ FL }}</label>
    <input
      id="hpa-slider"
      v-model="isobaric"
      type="range"
      min="100"
      max="1000"
      step="50"
      @input="updateLabel"
      @change="updateValue"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, inject, onUnmounted } from "vue";
import type { TangramApi } from "@open-aviation/tangram/api";
import "leaflet-velocity";
import "leaflet-velocity/dist/leaflet-velocity.css";

declare const L: any;
const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const isobaric = ref(300);
const FL = ref(300);
const velocityLayer = ref<any>(null);

const convertHpaToFlightLevel = (hpa: number) => {
  const P0 = 1013.25;
  const T0 = 288.15;
  const L = 0.0065;
  const g = 9.80665;
  const R = 287.05;
  const H_TROP = 11000;

  let altitude;
  if (hpa > 226.32) {
    altitude = (T0 / L) * (1 - Math.pow(hpa / P0, (L * R) / g));
  } else {
    const T_TROP = T0 - L * H_TROP;
    const P_TROP = P0 * Math.pow(T_TROP / T0, g / (L * R));
    altitude = H_TROP + ((T_TROP * R) / g) * Math.log(P_TROP / hpa);
  }
  return Math.round((altitude * 3.28084) / 1000) * 10;
};

const updateLabel = () => {
  FL.value = convertHpaToFlightLevel(isobaric.value);
};

const updateValue = () => {
  fetchAndDisplay();
};

const formatData = (data: any) => {
  return [
    {
      header: {
        parameterCategory: 2,
        parameterNumber: 2,
        dx: data.data_vars.u.attrs.GRIB_iDirectionIncrementInDegrees,
        dy: data.data_vars.u.attrs.GRIB_jDirectionIncrementInDegrees,
        la1: data.data_vars.u.attrs.GRIB_latitudeOfFirstGridPointInDegrees,
        lo1: data.data_vars.u.attrs.GRIB_longitudeOfFirstGridPointInDegrees,
        la2: data.data_vars.u.attrs.GRIB_latitudeOfLastGridPointInDegrees,
        lo2: data.data_vars.u.attrs.GRIB_longitudeOfLastGridPointInDegrees,
        nx: data.data_vars.u.attrs.GRIB_Nx,
        ny: data.data_vars.u.attrs.GRIB_Ny,
        refTime: new Date().toISOString()
      },
      data: data.data_vars.u.data.flat()
    },
    {
      header: {
        parameterCategory: 2,
        parameterNumber: 3,
        dx: data.data_vars.v.attrs.GRIB_iDirectionIncrementInDegrees,
        dy: data.data_vars.v.attrs.GRIB_jDirectionIncrementInDegrees,
        la1: data.data_vars.v.attrs.GRIB_latitudeOfFirstGridPointInDegrees,
        lo1: data.data_vars.v.attrs.GRIB_longitudeOfFirstGridPointInDegrees,
        la2: data.data_vars.v.attrs.GRIB_latitudeOfLastGridPointInDegrees,
        lo2: data.data_vars.v.attrs.GRIB_longitudeOfLastGridPointInDegrees,
        nx: data.data_vars.v.attrs.GRIB_Nx,
        ny: data.data_vars.v.attrs.GRIB_Ny,
        refTime: new Date().toISOString()
      },
      data: data.data_vars.v.data.flat()
    }
  ];
};

const fetchAndDisplay = async () => {
  if (!tangramApi.map.isReady.value) return;

  try {
    const response = await fetch(`/weather/wind?isobaric=${isobaric.value}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    const velocityData = formatData(data);

    if (velocityLayer.value) {
      velocityLayer.value.setData(velocityData);
    } else {
      const map = tangramApi.map.getMapInstance();
      velocityLayer.value = L.velocityLayer({
        displayValues: true,
        displayOptions: {
          velocityType: "Wind",
          position: "bottomleft",
          emptyString: "No wind data",
          angleConvention: "bearingCW",
          speedUnit: "ms"
        },
        data: velocityData,
        minVelocity: 0,
        maxVelocity: 100,
        velocityScale: 0.01,
        colorScale: [
          "#3288bd", // light blue
          "#66c2a5",
          "#abdda4",
          "#e6f598",
          "#fee08b",
          "#fdae61",
          "#f46d43",
          "#d53e4f" // dark red
        ]
      });
      velocityLayer.value.addTo(map);
    }
  } catch (error) {
    console.error("Failed to fetch or display wind data:", error);
  }
};

watch(
  tangramApi.map.isReady,
  isReady => {
    if (isReady) {
      fetchAndDisplay();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (velocityLayer.value && tangramApi.map.isReady.value) {
    tangramApi.map.getMapInstance().removeLayer(velocityLayer.value);
    velocityLayer.value = null;
  }
});
</script>

<style scoped>
.wind-altitude-control {
  position: absolute;
  bottom: 20px;
  right: 70px;
  background: rgba(255, 255, 255, 0.8);
  padding: 10px;
  border-radius: 5px;
  z-index: 1000;
}

.wind-altitude-control label {
  font-family: "B612", sans-serif;
  font-size: 12px;
}

input[type="range"] {
  cursor: pointer;
  width: 100%;
  margin-top: 5px;
  background: #bab0ac;
  height: 2px;
  border-radius: 5px;
}

.leaflet-control-velocity {
  width: 200px;
}
</style>
