// not using typescript because of an annoying vite bug:
// - https://github.com/vitejs/vite/issues/5370
// - https://github.com/vitejs/vite/issues/16040
// essentially, vite's on-the-fly transpilation is scoped only to the config
// file itself. therefore vite plugins in a monorepo cannot be typescript.
import vue from "@vitejs/plugin-vue";
import path from "path";
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

/**
 * @param {{ copyToPythonPackage?: boolean; pythonPackageDir?: string; includePackageJson?: boolean }} [options]
 * If the plugin is built with maturin, `copyToPythonPackage` should be 'true' to
 * avoid the built binary distribution wheel omitting the 'dist-frontend'.
 * See: https://github.com/open-aviation/tangram/pull/99#issuecomment-3777038726
 * @returns {import('vite').Plugin[]}
 */
export function tangramPlugin(options = {}) {
  const projectRoot = process.cwd();
  const copyToPythonPackage = options.copyToPythonPackage ?? false;
  const includePackageJson = options.includePackageJson ?? true;
  /** @type {{ name: string; main: string; }} */
  let pkg;
  let entryFileName;

  /** @type {import('vite').Plugin} */
  const configInjector = {
    name: "tangram-plugin-config-injector",
    async config() {
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
            formats: ["es"]
          },
          rollupOptions: {
            external: [
              "vue",
              "maplibre",
              ...DECKGL_PACKAGES,
              "lit-html",
              "rs1090-wasm",
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

  /** @type {import('vite').Plugin} */
  const manifestGenerator = {
    name: "tangram-manifest-generator",
    apply: "build",
    async writeBundle(outputOptions, bundle) {
      const outDir = outputOptions.dir;
      const cssAsset = Object.values(bundle).find(
        asset => asset.type === "asset" && asset.fileName.endsWith(".css")
      );

      const manifest = {
        name: pkg.name,
        main: `${entryFileName}.js`,
        ...(cssAsset && { style: cssAsset.fileName })
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
    async writeBundle(outputOptions) {
      if (!copyToPythonPackage) return;

      const outDir = outputOptions.dir
        ? path.resolve(projectRoot, outputOptions.dir)
        : path.resolve(projectRoot, "dist-frontend");
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

  return [vue(), configInjector, manifestGenerator, pythonPackageSync];
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
