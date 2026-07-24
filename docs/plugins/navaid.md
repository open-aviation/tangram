# Navaid Plugin

The `tangram_navaid` plugin extends the command palette with browser-side search for navaids, fixes, and ICAO Field 15 route expressions.

Selecting a navaid or fix centres the map on the point and adds a removable map layer. Selecting a Field 15 expression resolves the route and draws its points and segments as removable layers.

## Data Sources

The plugin loads navigation data in the browser through [`traffic.js`](https://github.com/xoolive/traffic.js):

- X-Plane navdata provides the navaid/fix search index, supporting navigation-object lookup.
- A EUROCONTROL DDR archive provides the primary route-resolution data, including airway, airport, SID, and STAR geometry.
- FAA ArcGIS data can be enabled for additional U.S. coverage.

The Field 15 parser and DDR resolver use a [`thrust-wasm`](https://github.com/xoolive/thrust) module bundled with the plugin. `traffic.js` itself is loaded as an ESM module from the configured URL.

!!! warning

    Route resolution is best-effort and depends on the coverage and effective date of the configured sources. It should not be treated as operational navigation data.

## Configuration

Enable the plugin in `tangram.toml`:

```toml title="tangram.toml"
[core]
plugins = ["tangram_navaid"]
```

Optional source configuration belongs in `[plugins.tangram_navaid]`:

```toml title="tangram.toml"
[plugins.tangram_navaid]
# ddr_archive_url = "https://example.com/ddr.zip"
# traffic_js_url = "https://example.com/traffic.js"
# enable_faa = true
```

See [`tangram_navaid.TangramNavaidConfig`][] for the settings and their defaults.
