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
          src: path.resolve(
            __dirname,
            "node_modules/vue/dist/vue.esm-browser.prod.js"
          ),
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
    outDir: path.resolve(__dirname, "./src/tangram/dist-frontend"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html")
    }
  }
});
