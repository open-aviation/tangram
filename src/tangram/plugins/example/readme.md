# Example plugin

This is an example plugin for the tangram framework.

It serves as a minimal template for creating new backend plugins for API services.

The procedure is as simple as:

- Create a new directory in the `src/tangram/plugins/` directory.
- Add the plugin to the `src/tangram/plugins/__init__.py` file: it will need a `router` instance and a `register_plugin` function. The `register_plugin` will be called when the module is discovered at runtime.

You can explore more plugins in the `src/tangram/plugins/` directory to see how they are structured. A more complete documentation is available at <https://mode-s.org/tangram/plugins/>
