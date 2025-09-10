import { createApp } from "vue";
import App from "./App.vue";
import "leaflet/dist/leaflet.css";
import "./user.css";
// leaflet-rotatedmarker plugin expects a global L object
import * as L from "leaflet";

(window as any).L = L;

createApp(App).mount("#app");
