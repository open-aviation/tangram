import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tangramPlugin } from "@open-aviation/tangram-core/vite-plugin";

// thrust-wasm is the WebAssembly helper traffic.js uses for Field 15 parsing
// and EUROCONTROL DDR route enrichment. Its CDN auto-load is unreliable through
// the esm.sh shim, so — following the rs1090-wasm pattern in tangram_datalink —
// we bundle the self-contained web loader and its sibling .wasm as plugin
// assets and load them locally via ctx.importModule at runtime.
const thrustLoader = fileURLToPath(import.meta.resolve("thrust-wasm/web"));
const thrustWasm = path.join(
  path.dirname(thrustLoader),
  "thrust_wasm_bg.wasm"
);

export default defineConfig({
  plugins: [
    tangramPlugin({
      assets: [
        { source: thrustLoader, fileName: "thrust_wasm.js" },
        { source: thrustWasm, fileName: "thrust_wasm_bg.wasm" }
      ]
    })
  ]
});
