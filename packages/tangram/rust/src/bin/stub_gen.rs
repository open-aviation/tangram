use pyo3_stub_gen::Result;
use tangram_core::stub_info;

// finds the module name (`tangram._core`) from pyproject.toml and generates
// the pyi at `packages/tangram/src/tangram/_core.pyi`
fn main() -> Result<()> {
    let stub = stub_info()?;
    stub.generate()?;
    Ok(())
}
