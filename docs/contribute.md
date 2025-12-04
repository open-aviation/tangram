# Contribute to tangram

We aim to provide a quality codebase with documentation, but expect that you will find bugs and issues, and hope you will also imagine very creative plugins.

We welcome contributions to the project, whether it is code, documentation, or bug reports.

## Bug reports

Please file bug reports on the [GitHub issue tracker](https://github.com/open-aviation/tangram/issues).

When filing a bug report, please include the following information:

- A clear description of the issue
- Steps to reproduce the issue
- Expected and actual behaviour
- Any relevant logs or error messages
- Your environment (OS, browser, etc.)

## Bug fixes and contributions

If you want to contribute code, please follow these steps:

1. Fork the repository on GitHub
2. Create a new branch for your feature or bug fix
3. Make your changes and commit them with a clear message
4. Push your changes to your forked repository
5. Create a pull request against the `main` branch of the original repository
6. Include a clear description of your changes and why they are needed
7. Ensure your code follows the project's coding standards and passes all tests
8. If your changes are related to a specific issue, reference that issue in your pull request description

## Plugins

If you want to share a plugin you have developed, please start by sharing a preview in the [Discussions](https://github.com/open-aviation/tangram/discussions)

## Style guide

We do not want to be too strict about the coding standards, but we expect that you will follow the general style guides of the rest of the codebase. Ensure your contribution doesn't reformat existing code unnecessarily, as this can make it harder to review changes.

Please take into account the `.editorconfig` file in the root of the repository, which defines the coding style for the project. You can find more information about EditorConfig [here](https://editorconfig.org/) and install plugins for your favourite editor.

## Development Workflow

The project is structured as a monorepo with `uv` managing the Python workspaces and `pnpm` managing the frontend workspaces.

### Building for Distribution

Each Python package (the core `tangram` and its plugins) can be built into a standard wheel for distribution. The frontend assets should first be built so downstream users won't have to install npm.

```sh
# from the repository root
pnpm i
pnpm build
uv build --all-packages
```

### Testing Channel Core

The core WebSocket logic is written in Rust. To run these tests, you need a local Redis instance:

```bash
# in packages/tangram_core/rust
cargo test --features channel
```

### Continuous Integration

The CI pipeline, defined in GitHub Actions, automates quality checks and builds. The primary steps are:

1. **Building Wheel**: The build process above is automated for all versions from Python 3.10 to 3.13, on Linux, MacOS, Windows and processor architectures.
2. **Testing**: Python tests are executed using `pytest` (scope is limited for now)
3. **Container Build**: A podman image is built using the root `Containerfile`, serving as an integration test.

!!! warning
    The `tangram_weather` plugin depends on the `eccodes` library, which is problematic on non-`x86_64` systems. You can choose to build the `eccodes` library from source with the `ECCODES_STRATEGY` in the container build argument.
