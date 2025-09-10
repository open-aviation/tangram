import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: [
            path.resolve(__dirname, "node_modules/vue/dist/vue.esm-browser.prod.js"),
            path.resolve(__dirname, "node_modules/leaflet/dist/leaflet-src.esm.js"),
            path.resolve(
              __dirname,
              "node_modules/leaflet/dist/leaflet-src.esm.js.map"
            ),
            path.resolve(
              __dirname,
              "node_modules/lit-html/lit-html.js"
            ),
            path.resolve(
              __dirname,
              "node_modules/lit-html/lit-html.js.map"
            )
          ],
          dest: "."
        }
      ]
    })
  ],
  build: {
    /* we need to include the vite output in the python wheel.
     * according to https://www.maturin.rs/config.html#maturin-options
     * when `[tool.maturin.include]` is set `maturin` should copy it into the
     * wheel:
     * ├── package.json
     * ├── pyproject.toml
     * ├── dist-frontend   <-- this
     * │   ├── index.html
     * │   └── ...
     * └── src
     *     └── tangram
     * but for some reason maturin doesn't copy it,
     * so we output to the src dir for now.
     */
    sourcemap: true,
    outDir: path.resolve(__dirname, "./src/tangram/dist-frontend"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      external: ["vue", "leaflet", "lit-html"]
    }
  }
});
