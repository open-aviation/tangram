import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

const DECKGL_PACKAGES = [
  "@deck.gl/core",
  "@deck.gl/layers",
  "@deck.gl/aggregation-layers",
  "@deck.gl/geo-layers",
  "@deck.gl/mesh-layers",
  "@deck.gl/json",
  "@deck.gl/mapbox",
  "@deck.gl/widgets",
  "@deck.gl/extensions"
];
// when modifying, also update:
// - ./index.html (importmap)
// - ./vite.lib-esm.config.ts
// - ./src/tangram_core/vite-plugin-tangram.mjs
// - ../../tsconfig.json paths

export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: [
            path.resolve(__dirname, "node_modules/vue/dist/vue.esm-browser.prod.js"),
            path.resolve(__dirname, "node_modules/maplibre-gl/dist/maplibre-gl.js"),
            path.resolve(__dirname, "node_modules/maplibre-gl/dist/maplibre-gl.js.map"),
            path.resolve(__dirname, "node_modules/lit-html/lit-html.js"),
            path.resolve(__dirname, "node_modules/lit-html/lit-html.js.map"),
            path.resolve(__dirname, "node_modules/lit-html/lit-html.js.map"),
            /*
             * HACK: Putting `rs1090` in the core would seem very strange, because `jet1090`
             * is the only consumer of it. However, this is necessary to work around
             * an annoying bug in `vite` preventing inclusion:
             *
             * - https://github.com/vitejs/vite/discussions/13172
             * - https://github.com/vitejs/vite/issues/4454
             *
             * Tangram core is built with Vite *application* mode, but tangram plugins are built
             * in *library* mode. There are some differences in how assets are handled
             * between the two modes.
             *
             * In `rs1090-wasm/web/rs1090_wasm.js`, it uses
             * `fetch(new URL('rs1090_wasm_bg.wasm', import.meta.url))` to load the wasm.
             * But vite library mode tries to convert the entire binary into a base64 data URI,
             * and for some reason it is utterly broken.
             *
             * Several workarounds were attempted, including:
             *
             * - using `?url` and/or `?no-inline` suffixes in the import statement,
             * - setting `rollupOptions.external` to `[/\.wasm$/]`,
             * - adopting this plugin: https://github.com/laynezh/vite-plugin-lib-assets
             *   (this seems the most promising: wasm is copied but bindgen code doesn't work)
             *
             * So we just copy the files over manually for now.
             */
            path.resolve(__dirname, "node_modules/rs1090-wasm/web/rs1090_wasm.js"),
            path.resolve(__dirname, "node_modules/rs1090-wasm/web/rs1090_wasm_bg.js"),
            path.resolve(__dirname, "node_modules/rs1090-wasm/web/rs1090_wasm_bg.wasm"),
            path.resolve(
              __dirname,
              "node_modules/font-awesome/css/font-awesome.min.css"
            )
          ],
          dest: "."
        },
        {
          src: path.resolve(__dirname, "node_modules/font-awesome/fonts/*"),
          dest: "fonts"
        }
      ]
    })
  ],
  build: {
    sourcemap: true,
    outDir: path.resolve(__dirname, "./dist-frontend"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
      external: ["vue", "maplibre", ...DECKGL_PACKAGES, "lit-html", "rs1090-wasm"]
    }
  }
});
