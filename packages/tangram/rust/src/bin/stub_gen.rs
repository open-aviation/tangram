use _channel::stub_info;
use pyo3_stub_gen::Result;

// finds the module name (`tangram._channel`) from pyproject.toml and generates
// the pyi at `packages/tangram/src/tangram/_channel.pyi`
fn main() -> Result<()> {
    let stub = stub_info()?;
    stub.generate()?;
    Ok(())
}
