use std::cell::{Cell, RefCell};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use local_studio_core::{DaemonLaunch, Studio, StudioConfig, StudioError, Update, Waker};

struct ChannelWaker(async_channel::Sender<()>);

impl Waker for ChannelWaker {
    fn wake(&self) {
        self.0.try_send(()).ok();
    }
}

#[derive(Default)]
pub struct Core {
    studio: RefCell<Option<Arc<Studio>>>,
    requests: Cell<u64>,
}

impl Core {
    pub fn start(&self, on_wake: impl Fn() + 'static) -> Result<(), StudioError> {
        let (sender, receiver) = async_channel::bounded(1);
        let config = StudioConfig {
            socket_path: Some(socket_path().to_string_lossy().into_owned()),
            session_dir: None,
            data_dir: None,
            launch: daemon_program().map(|program| DaemonLaunch { program, arguments: vec!["supervisor".to_string()] }),
        };
        let studio = Studio::new(config, Arc::new(ChannelWaker(sender)))?;
        self.studio.replace(Some(studio));
        gtk::glib::spawn_future_local(async move {
            while receiver.recv().await.is_ok() {
                on_wake();
            }
        });
        Ok(())
    }

    pub fn is_live(&self) -> bool {
        self.studio.borrow().is_some()
    }

    pub fn tick(&self) -> Vec<Update> {
        self.studio.borrow().as_ref().map(|studio| studio.tick()).unwrap_or_default()
    }

    pub fn run(&self, action: impl FnOnce(&Studio)) {
        let studio = self.studio.borrow().clone();
        if let Some(studio) = studio {
            action(&studio);
        }
    }

    pub fn request(&self) -> String {
        let next = self.requests.get() + 1;
        self.requests.set(next);
        format!("gtk-{next}")
    }

    pub fn stop(&self) {
        if let Some(studio) = self.studio.take() {
            studio.shutdown();
        }
    }
}

fn socket_path() -> PathBuf {
    if let Some(socket) = std::env::var_os("EUKHE_DAEMON_SOCKET").filter(|value| !value.is_empty()) {
        return PathBuf::from(socket);
    }
    let uid = std::fs::metadata("/proc/self").map(|meta| meta.uid()).unwrap_or_default();
    std::env::temp_dir().join(format!("eukhe-{uid}")).join("daemon.sock")
}

fn daemon_program() -> Option<String> {
    if let Some(program) = std::env::var_os("EUKHE_DAEMON").filter(|value| !value.is_empty()) {
        return Some(program.to_string_lossy().into_owned());
    }
    let sibling = std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("eukhe-daemon")));
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join("eukhe-daemon"));
    sibling.into_iter().chain(on_path).find(|path| is_executable(path)).map(|path| path.to_string_lossy().into_owned())
}

fn is_executable(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.mode() & 0o111 != 0)
}
