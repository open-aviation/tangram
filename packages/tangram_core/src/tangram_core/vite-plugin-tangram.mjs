// @ts-check
// not using typescript because of an annoying vite bug:
// - https://github.com/vitejs/vite/issues/5370
// - https://github.com/vitejs/vite/issues/16040
// essentially, vite's on-the-fly transpilation is scoped only to the config
// file itself. therefore vite plugins in a monorepo cannot be typescript.
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs/promises";

// dedicated from vite's normal outputs
// arbitrary third-party emitFile() collisions are not policed!
const PLUGIN_ASSET_DIR = "plugin-assets";

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

/** @typedef {import("./vite-plugin-tangram.mjs").TangramPluginOptions} TangramPluginOptions */

/**
 * @param {TangramPluginOptions} [options]
 * If the plugin is built with maturin, `copyToPythonPackage` should be 'true' to
 * avoid the built binary distribution wheel omitting the 'dist-frontend'.
 * See: https://github.com/open-aviation/tangram/pull/99#issuecomment-3777038726
 * @returns {import('vite').Plugin[]}
 */
export function tangramPlugin(options = {}) {
  let projectRoot = process.cwd();
  const copyToPythonPackage = options.copyToPythonPackage ?? false;
  const includePackageJson = options.includePackageJson ?? true;
  const assets = options.assets ?? [];
  /** @type {string | undefined} */
  let resolvedOutDir;
  /** @type {{ name: string; main: string }} */
  let pkg;
  /** @type {string} */
  let entryFileName;

  /** @type {import('vite').Plugin} */
  const configInjector = {
    name: "tangram-plugin-config-injector",
    async config(userConfig) {
      projectRoot = path.resolve(userConfig.root ?? process.cwd());
      const pkgPath = path.resolve(projectRoot, "package.json");
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));

      if (!pkg.main) {
        throw new Error(
          `\`main\` field must be specified in ${pkg.name}'s package.json`
        );
      }
      entryFileName = path.parse(pkg.main).name;

      /** @type {import('vite').UserConfig} */
      const tangramBuildConfig = {
        build: {
          sourcemap: true,
          lib: {
            entry: pkg.main,
            fileName: entryFileName,
            cssFileName: entryFileName,
            formats: ["es"]
          },
          rolldownOptions: {
            external: [
              "vue",
              "maplibre",
              ...DECKGL_PACKAGES,
              "lit-html",
              "parquet-wasm"
            ]
          },
          outDir: "dist-frontend",
          minify: true
        }
      };
      return tangramBuildConfig;
    }
  };

  /*
   * This plugin is a workaround for an annoying bug in Vite library mode preventing
   * inclusion of large files like `rs1090-wasm`. See:
   *
   * - https://github.com/vitejs/vite/discussions/13172
   * - https://github.com/vitejs/vite/issues/4454
   * - browser module-map behavior relevant to failed dynamic imports:
   *   https://html.spec.whatwg.org/multipage/webappapis.html
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
   * So we let plugins register their assets and serve them under a special namespace.
   */

  /** @type {import('vite').Plugin} */
  const assetEmitter = {
    name: "tangram-plugin-assets",
    apply: "build",
    async buildStart() {
      const emittedFileNames = new Set();
      for (const asset of assets) {
        const sourcePath = path.isAbsolute(asset.source)
          ? asset.source
          : path.resolve(projectRoot, asset.source);
        const fileName = normalizeAssetFileName(
          asset.fileName ?? path.basename(sourcePath)
        );
        const duplicateKey = fileName.toLowerCase();
        if (emittedFileNames.has(duplicateKey)) {
          throw new Error(`duplicate plugin asset filename: ${fileName}`);
        }
        emittedFileNames.add(duplicateKey);
        this.addWatchFile(sourcePath);
        this.emitFile({
          type: "asset",
          fileName: `${PLUGIN_ASSET_DIR}/${fileName}`,
          source: await fs.readFile(sourcePath)
        });
      }
    }
  };

  /** @type {import('vite').Plugin} */
  const manifestGenerator = {
    name: "tangram-manifest-generator",
    apply: "build",
    async writeBundle(outputOptions, bundle) {
      const outDir = outputOptions.dir;
      if (!outDir) {
        throw new Error("vite build.outDir was not resolved"); // for ts
      }
      // we do not support custom output naming, we should have stable entry/css
      // names because of plugin.json.
      const main = `${entryFileName}.js`;
      const entry = bundle[main];
      if (!entry || entry.type !== "chunk" || !entry.isEntry) {
        throw new Error(`plugin entry output is missing: ${main}`);
      }
      const style = `${entryFileName}.css`;

      const manifest = {
        name: pkg.name,
        main,
        ...(bundle[style]?.type === "asset" && { style })
      };
      await fs.writeFile(
        path.resolve(outDir, "plugin.json"),
        JSON.stringify(manifest, null, 2)
      );
    }
  };

  /** @type {import('vite').Plugin} */
  const pythonPackageSync = {
    name: "tangram-python-package-sync",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      resolvedOutDir = config.build.outDir;
    },
    async closeBundle() {
      if (!copyToPythonPackage) return;

      if (!resolvedOutDir) {
        throw new Error("vite build.outDir was not resolved");
      }
      const outDir = path.isAbsolute(resolvedOutDir)
        ? resolvedOutDir
        : path.resolve(projectRoot, resolvedOutDir);
      const pythonPackageDir = options.pythonPackageDir
        ? path.resolve(projectRoot, options.pythonPackageDir)
        : path.resolve(projectRoot, path.dirname(pkg.main));
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

  return [vue(), configInjector, assetEmitter, manifestGenerator, pythonPackageSync];
}

/**
 * @param {string} src
 * @param {string} dst
 */
async function copyDirRecursive(src, dst) {
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

/**
 * @param {string} fileName
 */
function normalizeAssetFileName(fileName) {
  if (
    !fileName ||
    path.posix.isAbsolute(fileName) ||
    fileName.includes("\\") ||
    fileName.includes("?") ||
    fileName.includes("#")
  ) {
    throw new Error(`invalid plugin asset filename: ${fileName}`);
  }
  const normalized = path.posix.normalize(fileName);
  const segments = normalized.split("/");
  if (
    normalized !== fileName ||
    segments.some(segment => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`invalid plugin asset filename: ${fileName}`);
  }
  return normalized;
}
