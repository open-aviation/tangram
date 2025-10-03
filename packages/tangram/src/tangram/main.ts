import { createApp } from "vue";
import App from "./App.vue";
import "leaflet/dist/leaflet.css";
import "./user.css";
// leaflet-rotatedmarker plugin expects a global L object
// leaflet-velcity further requires L to be mutable
import * as leaflet from "leaflet";

const L = { ...leaflet };
(window as any).L = L;

L.Icon.Default.prototype.options.imagePath = "/images/";

createApp(App).mount("#app");
