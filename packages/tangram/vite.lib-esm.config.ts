/* We want to provide deck.gl to both the core and downstream plugins,
 * so we want to share a single ESM build. We cannot copy `dist.min.js` because
 * it uses UMD script tag which is incompatible with importmaps.
 *
 * Fortunately, deck.gl>=9 packages provide ESM builds, but are split into many
 * files across dependencies, making it difficult to copy them all.
 *
 * We therefore try to "compile" it into a single ESM bundle using Vite/Rollup.
 * An alternative would be to use [`esbuild`](https://github.com/manzt/anywidget/issues/369#issuecomment-1792376003)
 * but we are already using Vite so this is more convenient.
 */
import { defineConfig, type Plugin } from "vite";
import path from "path";

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

/* Use a virtual module plugin to create explicit re-exports,
 * preventing tree-shaking caused by `sideEffects: false` in deck.gl packages.
 */
function virtualDeckGLEntries(): Plugin {
  const virtualPrefix = "virtual:deckgl-entry:";
  const resolvedPrefix = "\0" + virtualPrefix;

  return {
    name: "vite-plugin-deckgl-virtual-entries",
    resolveId(id) {
      if (id.startsWith(virtualPrefix)) {
        return resolvedPrefix + id.slice(virtualPrefix.length);
      }
      return null;
    },
    load(id) {
      if (id.startsWith(resolvedPrefix)) {
        const pkgName = id.slice(resolvedPrefix.length);
        return `export * from '${pkgName}';`;
      }
      return null;
    }
  };
}

export default defineConfig({
  // `webgl-developer-tools` is intended for node, perform a direct text replacement
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: path.resolve(__dirname, "./src/tangram/dist-frontend"),
    rollupOptions: {
      input: Object.fromEntries(
        DECKGL_PACKAGES.map(pkg => [
          pkg.split("/").pop(),
          `${"virtual:deckgl-entry:"}${pkg}`
        ])
      ),
      output: {
        format: "es",
        entryFileNames: "[name].js"
      },
      // required avoid rollup tree-shaking unused exports from entry points
      preserveEntrySignatures: "strict"
    },
    minify: true,
    sourcemap: true,
    emptyOutDir: false
  },
  plugins: [virtualDeckGLEntries()]
});
