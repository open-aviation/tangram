# Example plugin

This is an example plugin for the tangram framework.

It serves as a minimal template for creating new backend plugins for API services.

A plugin is a standard Python package that uses entry points in its `pyproject.toml` to make itself discoverable by `tangram`. See the `[project.entry-points."tangram_core.plugins"]` section for an example.

The plugin's `__init__.py` should define a `plugin = tangram_core.Plugin()` instance and use its decorators (`@plugin.register_router`, `@plugin.register_service`) to register components.

You can explore more plugins in the `packages/*` directory to see how they are structured. A more complete documentation is available at <https://mode-s.org/tangram/plugins/>
