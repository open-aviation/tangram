import { defineConfig } from "vite";
import { tangramPlugin } from "@open-aviation/tangram/vite-plugin";

export default defineConfig({
  plugins: [tangramPlugin()],
});