import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { tangramPlugin } from "../src/tangram_core/vite-plugin-tangram.mjs";

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

describe("tangramPlugin assets", () => {
  // we dont want auxilary css file to become plugin json primary stylesheet.
  // we use a plugin-assets namespace which prevents those collisions.
  // note that arbitrary third-party emitFile() collisions may still occur but we
  // dont handle that. see:
  // - https://vite.dev/config/build-options.html#build-lib
  // - https://github.com/vitejs/vite/issues/4863
  // - https://github.com/vitejs/vite/issues/3295
  it("keeps copied modules and css outside the entry namespace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tangram-vite-plugin-"));
    fixtures.push(root);
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture-plugin", type: "module", main: "src/index.ts" })
    );
    await writeFile(
      path.join(root, "src/index.ts"),
      'import "./style.css"; export function install() {}\n'
    );
    await writeFile(path.join(root, "src/style.css"), ".entry { display: block; }\n");
    await writeFile(path.join(root, "loader.js"), "export const auxiliary = true;\n");
    await writeFile(
      path.join(root, "auxiliary.css"),
      ".auxiliary { display: none; }\n"
    );

    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: tangramPlugin({
        assets: [
          { source: "loader.js", fileName: "index.js" },
          { source: "auxiliary.css", fileName: "auxiliary.css" }
        ]
      })
    });

    const output = path.join(root, "dist-frontend");
    const manifest = JSON.parse(
      await readFile(path.join(output, "plugin.json"), "utf8")
    );
    expect(await readFile(path.join(output, "index.js"), "utf8")).toContain("install");
    expect(
      await readFile(path.join(output, "plugin-assets/index.js"), "utf8")
    ).toContain("auxiliary");
    expect(manifest).toMatchObject({ main: "index.js", style: "index.css" });
  });
});
