use tokio::sync::watch;
use tokio::task::JoinHandle;

#[derive(Debug)]
pub struct Shutdown {
    sender: watch::Sender<bool>,
}

impl Shutdown {
    pub fn new() -> (Self, watch::Receiver<bool>) {
        let (sender, receiver) = watch::channel(false);
        (Self { sender }, receiver)
    }

    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.sender.subscribe()
    }

    pub fn trigger(&self) {
        let _ = self.sender.send(true);
    }
}

impl Drop for Shutdown {
    fn drop(&mut self) {
        let _ = self.sender.send(true);
    }
}

pub async fn abort_and_await<T>(handle: &mut JoinHandle<T>) {
    if handle.is_finished() {
        return;
    }
    handle.abort();
    let _ = handle.await;
}
