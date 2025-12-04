import { createApp } from "vue";
import App from "./App.vue";
import "maplibre-gl/dist/maplibre-gl.css";
import "./user.css";

import "@fontsource/inconsolata/400.css";
import "@fontsource/inconsolata/700.css";
import "@fontsource/roboto-condensed/400.css";
import "@fontsource/roboto-condensed/400-italic.css";
import "@fontsource/roboto-condensed/500.css";
import "@fontsource/roboto-condensed/700.css";
import "@fontsource/b612/400.css";
import "@fontsource/b612/400-italic.css";
import "@fontsource/b612/700.css";

import init, { run } from "rs1090-wasm";

// initialising wasm manually because esm build doesn't work well in wheels.
// NOTE: `tangram_jet1090` and `tangram_airports` depend on `rs1090` to query
// aircraft and airport information respectively.
// until we figure out how to make one plugin share dependencies with another
// plugin, we will have to forcefully initialise `rs1090` here.
// See: https://github.com/open-aviation/tangram/issues/46
(async () => {
  await init("/rs1090_wasm_bg.wasm");
  run();
  createApp(App).mount("#app");
})();
