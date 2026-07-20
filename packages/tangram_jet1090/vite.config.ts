import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tangramPlugin } from "@open-aviation/tangram-core/vite-plugin";

const rs1090Loader = fileURLToPath(import.meta.resolve("rs1090-wasm/web"));
const rs1090Wasm = path.join(path.dirname(rs1090Loader), "rs1090_wasm_bg.wasm");

export default defineConfig({
  plugins: [
    tangramPlugin({
      assets: [
        { source: rs1090Loader, fileName: "rs1090_wasm.js" },
        { source: rs1090Wasm, fileName: "rs1090_wasm_bg.wasm" }
      ],
      copyToPythonPackage: true
    })
  ]
});
