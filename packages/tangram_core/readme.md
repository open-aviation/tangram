# tangram_core

`tangram_core` is the core of the tangram framework, designed to aggregate and process ADS-B and Mode S surveillance data for real-time analysis. It provides a flexible plugin architecture that allows users to implement custom components for their specific needs.

Documentation is available at <https://mode-s.org/tangram/>.
Repository: <https://github.com/open-aviation/tangram>

## Components

- Backend: A Python backend built with FastAPI. The backend also exposes a WebSocket interface for real-time data visualization and analysis (written in Rust)

- Frontend: A JavaScript frontend built with TypeScript and Vue.js. The frontend connects to the backend via WebSocket to display real-time data and visualizations.

The full package is published as a Python package named [`tangram_core`](https://pypi.org/project/tangram_core/): it contains a compiled Rust library together with the frontend assets.

- The Rust library is also available separately as a crate: [`tangram_core`](https://crates.io/crates/tangram_core), and can be used to build custom plugins with Rust.

- The frontend library is also available separately as an npm package: [`@open-aviation/tangram-core`](https://www.npmjs.com/package/@open-aviation/tangram-core), and can be used to build custom frontend components.
