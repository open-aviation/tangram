pub mod message;
pub mod run_service;
pub mod state;

#[cfg(feature = "pyo3")]
use pyo3::prelude::*;
#[cfg(feature = "pyo3")]
use pyo3_async_runtimes::tokio::future_into_py;
#[cfg(feature = "stubgen")]
use pyo3_stub_gen::derive::*;

#[cfg_attr(feature = "stubgen", gen_stub_pyclass)]
#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all))]
#[derive(Clone)]
pub struct DatalinkConfig {
    pub redis_url: String,
    pub state_vector_expire: u16,
    pub stream_interval_secs: f64,
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pymethods)]
#[pymethods]
impl DatalinkConfig {
    #[new]
    fn new(redis_url: String, state_vector_expire: u16, stream_interval_secs: f64) -> Self {
        Self {
            redis_url,
            state_vector_expire,
            stream_interval_secs,
        }
    }
}

#[cfg(feature = "pyo3")]
#[cfg_attr(feature = "stubgen", gen_stub_pyfunction)]
#[pyfunction]
fn run_datalink(py: Python<'_>, config: DatalinkConfig) -> PyResult<Bound<'_, PyAny>> {
    future_into_py(py, async move {
        crate::run_service::run_service(config)
            .await
            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))
    })
}

#[cfg(feature = "pyo3")]
#[pymodule]
fn _datalink(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(run_datalink, m)?)?;
    m.add_class::<DatalinkConfig>()?;
    Ok(())
}

#[cfg(feature = "stubgen")]
pub fn stub_info() -> pyo3_stub_gen::Result<pyo3_stub_gen::StubInfo> {
    let manifest_dir: &::std::path::Path = env!("CARGO_MANIFEST_DIR").as_ref();
    let pyproject_path = manifest_dir.parent().unwrap().join("pyproject.toml");
    pyo3_stub_gen::StubInfo::from_pyproject_toml(pyproject_path)
}
