import { defineConfig, normalizePath, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";
import fs from "fs/promises";
import {
  DECKGL_RESOLVE_CONDITIONS,
  SHARED_MODULE_IMPORTS,
  SHARED_MODULE_SPECIFIERS
} from "./src/tangram_core/vite-shared.mjs";

// NOTE: normalizePath required for windows: https://github.com/sapphi-red/vite-plugin-static-copy/blob/4746d00ce0644a96313be438738b8ca8066b6562/README.md?plain=1#L42-L55
export default defineConfig({
  plugins: [
    vue(),
    sharedImportMapPlugin(),
    viteStaticCopy({
      targets: [
        {
          src: [
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/vue/dist/vue.esm-browser.prod.js"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl.mjs"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl.mjs.map"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs.map"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
                "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs.map"
              )
            ),
            normalizePath(
              path.resolve(import.meta.dirname, "node_modules/lit-html/lit-html.js")
            ),
            normalizePath(
              path.resolve(import.meta.dirname, "node_modules/lit-html/lit-html.js.map")
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
              path.resolve(
                import.meta.dirname,
                "node_modules/parquet-wasm/esm/parquet_wasm.js"
              )
            ),
            normalizePath(
              path.resolve(
                import.meta.dirname,
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
  resolve: {
    conditions: [...DECKGL_RESOLVE_CONDITIONS]
  },
  build: {
    sourcemap: true,
    outDir: normalizePath(path.resolve(import.meta.dirname, "./dist-frontend")),
    emptyOutDir: false,
    rolldownOptions: {
      input: normalizePath(path.resolve(import.meta.dirname, "index.html")),
      external: [...SHARED_MODULE_SPECIFIERS]
    }
  }
});

// we externalise vue esm so plugins dont have to vendor their own
// this results in a larger (initial) bundle size but is well worth
function sharedImportMapPlugin(): Plugin {
  return {
    name: "tangram-shared-import-map",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "importmap" },
          children: JSON.stringify({ imports: SHARED_MODULE_IMPORTS }, null, 2),
          injectTo: "head-prepend"
        }
      ];
    }
  };
}

// required workaround for https://github.com/open-aviation/tangram/pull/99#issuecomment-3777038726
function copyToPythonPackagePlugin(options: {
  enabled?: boolean;
  pythonPackageDir: string;
  includePackageJson?: boolean;
}): Plugin {
  const projectRoot = import.meta.dirname;
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
