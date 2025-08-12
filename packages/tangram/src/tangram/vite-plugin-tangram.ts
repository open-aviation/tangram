import type { Plugin, UserConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import fs from "fs/promises";

export function tangramPlugin(): Plugin[] {
  const projectRoot = process.cwd();
  let pkg: { name: string; main: string };
  let entryFileName: string;

  const configInjector: Plugin = {
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

      const tangramBuildConfig: UserConfig = {
        build: {
          lib: {
            entry: pkg.main,
            fileName: entryFileName,
            formats: ["es"]
          },
          rollupOptions: {
            external: ["vue"]
          },
          outDir: "dist-frontend",
          minify: true
        }
      };
      return tangramBuildConfig;
    }
  };

  const manifestGenerator: Plugin = {
    name: "tangram-manifest-generator",
    apply: "build",
    async writeBundle(outputOptions) {
      const outDir = outputOptions.dir!;
      const manifest = {
        name: pkg.name,
        main: `${entryFileName}.js`
      };
      await fs.writeFile(
        path.resolve(outDir, "plugin.json"),
        JSON.stringify(manifest, null, 2)
      );
    }
  };

  return [vue(), configInjector, manifestGenerator];
}
