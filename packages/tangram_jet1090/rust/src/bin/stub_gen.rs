use _planes::stub_info;
use pyo3_stub_gen::Result;

fn main() -> Result<()> {
    let stub = stub_info()?;
    stub.generate()?;
    Ok(())
}
