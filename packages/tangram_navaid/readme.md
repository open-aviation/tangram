# tangram_navaid

The `tangram_navaid` plugin extends the tangram search bar (Ctrl+P) with
navigation-data lookups: **navaids**, **fixes**, and **Field 15 route
expressions**. It complements the existing airports and history providers.

Selecting a navaid or fix flies the map to the point (like airports).
Selecting a Field 15 route expression parses, resolves, and draws the expanded
route as a map layer.

## Data sources

The plugin lazily loads [`traffic.js`](https://github.com/xoolive/traffic.js)
from a CDN at runtime — the same library and the same embedded data sources as
the [planned route encoding](https://mode-s.org/traffic/) interactive page:

- **EUROCONTROL DDR2 archive** is the **primary route-resolution source** and
  is preloaded by default from the same URL the reference page uses (~18 MB,
  browser-cached). It provides airway expansion, airports and SID/STAR geometry
  so Field 15 routes resolve out of the box.
- **X-Plane navdata** (`earth_nav.dat`, `earth_fix.dat`, `earth_awy.dat`) is
  the global source for navaid/fix search and a route fallback.

With X-Plane only, routes are drawn as direct segments between resolved
navaids, fixes, and coordinates — illustrative rather than authoritative, like
the reference page. The preloaded DDR archive gives full airway/airport fidelity
for European routes; configure `enable_faa` for United States coverage.

> `traffic.js` is loaded on demand from a CDN and never bundled into the plugin.
> Its `thrust-wasm` helper (used for Field 15 parsing and DDR route enrichment)
> is bundled locally as plugin assets so the WASM binary resolves reliably.

## Configuration

Add `tangram_navaid` to the `[core].plugins` list and (optionally) configure it:

```toml
[plugins.tangram_navaid]
# EUROCONTROL DDR2 archive URL. Defaults to the reference-page archive so
# routes resolve without configuration; set this to self-host.
# ddr_archive_url = "https://example.com/ddr.zip"
# Self-hosted traffic.js ESM build (defaults to the esm.sh CDN).
# traffic_js_url = "https://esm.sh/traffic.js@0.2.0"
# Attach the FAA ArcGIS United States source.
# enable_faa = false
```

## About Tangram

`tangram_navaid` is a plugin for `tangram`, an open framework for modular,
real-time air traffic management research.

- Documentation: <https://mode-s.org/tangram/>
- Repository: <https://github.com/open-aviation/tangram>

Installation:

```sh
# cli via uv
uv tool install --with tangram-navaid tangram-core
# with pip
pip install tangram-core tangram-navaid
```
