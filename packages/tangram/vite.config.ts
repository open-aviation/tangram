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
    outDir: path.resolve(__dirname, "./dist-frontend"),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html")
    }
  }
});
