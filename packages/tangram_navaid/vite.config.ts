import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tangramPlugin } from "@open-aviation/tangram-core/vite-plugin";

// traffic.js is bundled by Vite. thrust-wasm uses a sibling wasm binary, so
// keep its web loader and binary as explicit plugin assets.
const thrustLoader = fileURLToPath(import.meta.resolve("thrust-wasm/web"));
const thrustWasm = path.join(path.dirname(thrustLoader), "thrust_wasm_bg.wasm");

export default defineConfig({
  resolve: {
    // traffic.js bundles an unrelated Node-only rs1090 fallback. we never call
    // that aircraft metadata path, so replace it with a local stub.
    alias: {
      "rs1090-wasm/nodejs": fileURLToPath(
        new URL("./src/tangram_navaid/trafficNodeStub.ts", import.meta.url)
      ),
      url: fileURLToPath(
        new URL("./src/tangram_navaid/trafficNodeStub.ts", import.meta.url)
      )
    }
  },
  plugins: [
    tangramPlugin({
      assets: [
        { source: thrustLoader, fileName: "thrust_wasm.js" },
        { source: thrustWasm, fileName: "thrust_wasm_bg.wasm" }
      ]
    })
  ]
});
