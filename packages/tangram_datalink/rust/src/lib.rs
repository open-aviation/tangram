pub mod run_service;
pub mod state;

#[cfg(feature = "pyo3")]
use pyo3::prelude::*;
#[cfg(feature = "pyo3")]
use pyo3_async_runtimes::tokio::future_into_py;

#[cfg_attr(feature = "pyo3", pyclass(get_all, set_all, from_py_object))]
#[derive(Clone)]
pub struct DatalinkConfig {
    pub redis_url: String,
    pub state_vector_expire: u16,
    pub stream_interval_secs: f64,
}

#[cfg(feature = "pyo3")]
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
mod _datalink {
    #[pymodule_export]
    use super::run_datalink;

    #[pymodule_export]
    use super::DatalinkConfig;
}
