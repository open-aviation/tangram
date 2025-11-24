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
import { ref, watch, inject, onUnmounted, onMounted } from "vue";
import type { TangramApi, Disposable } from "@open-aviation/tangram-core/api";
import { ParticleLayer, ImageType } from "weatherlayers-gl";

const tangramApi = inject<TangramApi>("tangramApi");
if (!tangramApi) {
  throw new Error("assert: tangram api not provided");
}

const isobaric = ref(300);
const FL = ref(300);
const layerDisposable = ref<Disposable | null>(null);

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

async function loadTextureDataFromUri(
  uri: string
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return reject(new Error("Could not get 2d context from canvas"));
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      resolve({
        data: imageData.data,
        width: imageData.width,
        height: imageData.height
      });
    };
    img.onerror = err => {
      reject(err);
    };
    img.src = uri;
  });
}

const fetchAndDisplay = async () => {
  if (!tangramApi.map.isReady.value) return;

  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
  }

  try {
    const response = await fetch(`/weather/wind?isobaric=${isobaric.value}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const { imageDataUri, bounds, imageUnscale } = await response.json();

    const textureData = await loadTextureDataFromUri(imageDataUri);

    const windPalette: [number, [number, number, number]][] = [
      [0, [37, 99, 235]],
      [10, [65, 171, 93]],
      [20, [253, 174, 97]],
      [30, [244, 109, 67]],
      [40, [215, 25, 28]],
      [50, [128, 0, 38]]
    ];

    const windLayer = new ParticleLayer({
      id: "wind-field-layer",
      image: textureData,
      imageType: ImageType.VECTOR,
      imageUnscale: imageUnscale,
      bounds: bounds,

      numParticles: 1500,
      maxAge: 15,
      speedFactor: 20,
      width: 1,
      palette: windPalette,
      animate: true
    });

    layerDisposable.value = tangramApi.map.addLayer(windLayer);
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

onMounted(() => {
  FL.value = convertHpaToFlightLevel(isobaric.value);
});

onUnmounted(() => {
  if (layerDisposable.value) {
    layerDisposable.value.dispose();
    layerDisposable.value = null;
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
</style>
