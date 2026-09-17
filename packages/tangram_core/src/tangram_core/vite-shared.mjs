// @ts-check
// shared modules provided to all plugins
// keeping this as ESM JS because it is imported by the published Vite plugin

/** @type {readonly string[]} */
export const DECKGL_PACKAGES = [
  "@deck.gl/core",
  "@deck.gl/layers",
  "@deck.gl/aggregation-layers",
  "@deck.gl/geo-layers",
  "@deck.gl/mesh-layers",
  "@deck.gl/json",
  "@deck.gl/maplibre",
  "@deck.gl/widgets",
  "@deck.gl/extensions"
];

/** @type {Record<string, string>} */
export const SHARED_MODULE_IMPORTS = {
  vue: "/vue.esm-browser.prod.js",
  "maplibre-gl": "/maplibre-gl.mjs",
  ...Object.fromEntries(
    DECKGL_PACKAGES.map(pkg => [pkg, `/${pkg.split("/").at(-1)}.js`])
  ),
  "lit-html": "/lit-html.js",
  "parquet-wasm": "/parquet_wasm.js"
};

/** @type {string[]} */
export const SHARED_MODULE_SPECIFIERS = Object.keys(SHARED_MODULE_IMPORTS);

// maplibre-gl>=6.0 now uses WebGL2 exclusively, so we use interleaved: true.
// but deckgl>=9.4 also enables experimental WebGPU implementations that may
// break, so we force WebGL only.
/** @type {readonly string[]} */
export const DECKGL_RESOLVE_CONDITIONS = ["visgl:webgl-only"];
