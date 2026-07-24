# Navaid Plugin

The `tangram_navaid` plugin extends the command palette with browser-side search for navaids, fixes, and ICAO Field 15 route expressions.

It bundles [`traffic.js`](https://github.com/xoolive/traffic.js) and [`thrust-wasm`](https://github.com/xoolive/thrust) in its wheel.

Selecting a navaid or fix centres the map on the point and adds a removable map layer. Selecting a Field 15 expression resolves the route and draws its points and segments as removable layers.

## Data Sources

- X-Plane navdata provides the navaid/fix search index.
- A EUROCONTROL DDR archive provides airway, airport, SID, and STAR geometry for route resolution.
- FAA ArcGIS data can be enabled for additional U.S. coverage.

The backend caches the configured DDR, X-Plane, and FAA sources in the [configured cache directory][`tangram_navaid.TangramNavaidConfig.path_cache`]. Changing a source URL creates a separate cache entry.

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
# path_cache = "/var/cache/tangram_navaid"
# ddr_archive_url = "https://example.com/ddr.zip"
# enable_faa = true

# [plugins.tangram_navaid.xplane]
# nav_url = "https://example.com/earth_nav.dat"
# fix_url = "https://example.com/earth_fix.dat"
# awy_url = "https://example.com/earth_awy.dat"

# [plugins.tangram_navaid.faa]
# airports_url = "https://example.com/airports.geojson"
# routes_url = "https://example.com/routes.geojson"
# points_url = "https://example.com/points.geojson"
# navaids_url = "https://example.com/navaids.geojson"
```

See [`tangram_navaid.TangramNavaidConfig`][] for the settings and their defaults.
