import { defineConfig, normalizePath, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import fs from "fs/promises";

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

// NOTE: normalizePath required for windows: https://github.com/sapphi-red/vite-plugin-static-copy/blob/4746d00ce0644a96313be438738b8ca8066b6562/README.md?plain=1#L42-L55
export default defineConfig({
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        {
          src: [
            normalizePath(
              path.resolve(__dirname, "node_modules/vue/dist/vue.esm-browser.prod.js")
            ),
            normalizePath(
              path.resolve(__dirname, "node_modules/maplibre-gl/dist/maplibre-gl.js")
            ),
            normalizePath(
              path.resolve(
                __dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl.js.map"
              )
            ),
            normalizePath(path.resolve(__dirname, "node_modules/lit-html/lit-html.js")),
            normalizePath(
              path.resolve(__dirname, "node_modules/lit-html/lit-html.js.map")
            ),
            /**
             * In tangram>=0.5, we will migrate most things to parquet/arrow so we are putting
             * `parquet-wasm` in the core for the forseeable future.
             *
             * We are not putting some useful arrow packages here yet because:
             * - `arrow-js-ffi`: there is no esm, only source ts files
             * - `apache-arrow`: Arrow.mjs internally fetches a bunch of mjs
             * We need to modify vite.lib-esm.config.ts to bundle these properly.
             */
            normalizePath(
              path.resolve(__dirname, "node_modules/parquet-wasm/esm/parquet_wasm.js")
            ),
            normalizePath(
              path.resolve(
                __dirname,
                "node_modules/parquet-wasm/esm/parquet_wasm_bg.wasm"
              )
            )
          ],
          dest: ".",
          rename: { stripBase: true }
        }
      ]
    }),
    copyToPythonPackagePlugin({
      enabled: true,
      pythonPackageDir: "src/tangram_core",
      includePackageJson: true
    })
  ],
  build: {
    sourcemap: true,
    outDir: normalizePath(path.resolve(__dirname, "./dist-frontend")),
    emptyOutDir: false,
    rolldownOptions: {
      input: normalizePath(path.resolve(__dirname, "index.html")),
      external: ["vue", "maplibre", ...DECKGL_PACKAGES, "lit-html", "parquet-wasm"]
    }
  }
});

// required workaround for https://github.com/open-aviation/tangram/pull/99#issuecomment-3777038726
function copyToPythonPackagePlugin(options: {
  enabled?: boolean;
  pythonPackageDir: string;
  includePackageJson?: boolean;
}): Plugin {
  const projectRoot = __dirname;
  const enabled = options.enabled ?? false;
  const includePackageJson = options.includePackageJson ?? true;
  let resolvedOutDir: string | undefined;

  return {
    name: "tangram-python-package-sync",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      resolvedOutDir = config.build.outDir;
    },
    async closeBundle() {
      if (!enabled) return;

      const outDir = resolvedOutDir
        ? path.isAbsolute(resolvedOutDir)
          ? resolvedOutDir
          : path.resolve(projectRoot, resolvedOutDir)
        : path.resolve(projectRoot, "dist-frontend");
      const pythonPackageDir = path.resolve(projectRoot, options.pythonPackageDir);
      const distDst = path.join(pythonPackageDir, "dist-frontend");

      try {
        await fs.stat(outDir);
      } catch {
        return;
      }

      await fs.rm(distDst, { recursive: true, force: true });
      await copyDirRecursive(outDir, distDst);

      if (includePackageJson) {
        await fs.copyFile(
          path.resolve(projectRoot, "package.json"),
          path.join(pythonPackageDir, "package.json")
        );
      }
    }
  };
}

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(dstPath), { recursive: true });
      await fs.copyFile(srcPath, dstPath);
    }
  }
}
