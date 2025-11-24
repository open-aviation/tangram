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
 * @returns {import('vite').Plugin[]}
 */
export function tangramPlugin() {
  const projectRoot = process.cwd();
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
            external: ["vue", "maplibre", ...DECKGL_PACKAGES, "lit-html", "rs1090-wasm"]
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

  return [vue(), configInjector, manifestGenerator];
}
