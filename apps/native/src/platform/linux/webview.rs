use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;

use gio::ffi::{GAsyncReadyCallback, GAsyncResult};
use glib::DateTime;
use glib::ffi::{GFALSE, gpointer};
use glib::thread_guard::ThreadGuard;
use glib::translate::{IntoGlib as _, ToGlibNone as _};
use soup::Cookie as SoupCookie;
use webkit2gtk::{
    CookieManagerExt, WebViewExt, WebsiteDataManager, WebsiteDataManagerExt, WebsiteDataTypes,
};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::raw_window_handle::HasWindowHandle;
use wry::{Rect, WebContext, WebView, WebViewBuilder, WebViewExtUnix};

use crate::app_core::views::browser::{BrowserHostCookie, BrowserHostStore};

pub fn set_color_scheme(_view: &wry::WebView, _scheme: &str) {}

pub fn set_audio_muted(view: &wry::WebView, muted: bool) {
    let script = format!(
        "document.querySelectorAll('audio,video').forEach((media) => {{ media.muted = {muted}; }});"
    );
    let _ = view.evaluate_script(&script);
}

pub fn hard_reload(view: &wry::WebView) {
    let _ = view.reload();
}

pub fn stop_loading(view: &wry::WebView) {
    let _ = view.evaluate_script("window.stop()");
}

pub fn set_corner_radius(_view: &wry::WebView, _radius: f32) {}

pub struct Snapshot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn snapshot(
    _view: &wry::WebView,
    _max_width: f64,
    done: impl FnOnce(Result<Snapshot, String>) + 'static,
) {
    done(Err(
        "Browser screenshots are not available on Linux yet.".into()
    ));
}

#[derive(Clone, Copy)]
pub enum StoreData {
    Cookies,
    Cache,
}

fn soup_cookie(cookie: &BrowserHostCookie) -> Option<SoupCookie> {
    let mut soup_cookie = SoupCookie::new(
        &cookie.name,
        &cookie.value,
        &cookie.domain,
        &cookie.path,
        -1,
    );
    if let Some(seconds) = cookie.expires {
        soup_cookie.set_expires(&DateTime::from_unix_utc(seconds as i64).ok()?);
    }
    soup_cookie.set_secure(cookie.secure);
    soup_cookie.set_http_only(cookie.http_only);
    match cookie.same_site.as_deref() {
        Some("lax") => soup_cookie.set_same_site_policy(soup::SameSitePolicy::Lax),
        Some("strict") => soup_cookie.set_same_site_policy(soup::SameSitePolicy::Strict),
        _ => {}
    }
    Some(soup_cookie)
}

struct CookieWrites {
    written: Vec<bool>,
    remaining: usize,
    done: Option<Box<dyn FnOnce(Result<Vec<bool>, String>)>>,
}

fn finish_cookie(writes: &RefCell<CookieWrites>, index: usize, ok: bool) {
    let mut writes = writes.borrow_mut();
    if let Some(slot) = writes.written.get_mut(index) {
        *slot = ok;
    }
    writes.remaining = writes.remaining.saturating_sub(1);
    if writes.remaining > 0 {
        return;
    }
    let written = std::mem::take(&mut writes.written);
    let done = writes.done.take();
    drop(writes);
    if let Some(done) = done {
        done(Ok(written));
    }
}

type Helpers = Rc<RefCell<HashMap<u64, WebView>>>;

pub struct ProfileStores {
    contexts: HashMap<String, WebContext>,
    ephemeral_root: PathBuf,
    helpers: Helpers,
    next_helper: u64,
}

impl Default for ProfileStores {
    fn default() -> Self {
        Self {
            contexts: HashMap::new(),
            ephemeral_root: std::env::temp_dir()
                .join(format!("local-studio-incognito-{}", std::process::id())),
            helpers: Rc::new(RefCell::new(HashMap::new())),
            next_helper: 0,
        }
    }
}

impl Drop for ProfileStores {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.ephemeral_root);
    }
}

impl ProfileStores {
    fn context(&mut self, store: &BrowserHostStore) -> &mut WebContext {
        let directory = if store.persistent {
            PathBuf::from(&store.data_directory)
        } else {
            self.ephemeral_root.join(&store.id)
        };
        self.contexts
            .entry(store.id.clone())
            .or_insert_with(|| WebContext::new(Some(directory)))
    }

    pub fn builder<'a>(
        &'a mut self,
        store: &BrowserHostStore,
    ) -> Result<WebViewBuilder<'a>, String> {
        Ok(WebViewBuilder::new_with_web_context(self.context(store)))
    }

    fn data_manager(
        &mut self,
        store: &BrowserHostStore,
        window: &impl HasWindowHandle,
    ) -> Result<(WebsiteDataManager, u64), String> {
        let helper = WebViewBuilder::new_with_web_context(self.context(store))
            .with_visible(false)
            .with_bounds(Rect {
                position: LogicalPosition::new(0., 0.).into(),
                size: LogicalSize::new(1., 1.).into(),
            })
            .build_as_child(window)
            .map_err(|error| error.to_string())?;
        let manager = helper
            .webview()
            .website_data_manager()
            .ok_or_else(|| "The browser profile's data store is unavailable.".to_string())?;
        let key = self.next_helper;
        self.next_helper += 1;
        self.helpers.borrow_mut().insert(key, helper);
        Ok((manager, key))
    }

    pub fn clear(
        &mut self,
        store: &BrowserHostStore,
        data: StoreData,
        window: &impl HasWindowHandle,
        done: impl FnOnce(Result<(), String>) + 'static,
    ) {
        let (manager, key) = match self.data_manager(store, window) {
            Ok(found) => found,
            Err(error) => return done(Err(error)),
        };
        let types = match data {
            StoreData::Cookies => {
                WebsiteDataTypes::COOKIES
                    | WebsiteDataTypes::LOCAL_STORAGE
                    | WebsiteDataTypes::INDEXEDDB_DATABASES
                    | WebsiteDataTypes::SERVICE_WORKER_REGISTRATIONS
            }
            StoreData::Cache => WebsiteDataTypes::DISK_CACHE | WebsiteDataTypes::MEMORY_CACHE,
        };
        let helpers = self.helpers.clone();
        let manager_ptr = manager.to_glib_none().0;
        struct ClearRequest {
            manager: *mut webkit2gtk_sys::WebKitWebsiteDataManager,
            finish: ThreadGuard<Box<dyn FnOnce(Result<(), String>)>>,
        }
        let request = Box::into_raw(Box::new(ClearRequest {
            manager: manager_ptr,
            finish: ThreadGuard::new(Box::new(move |result: Result<(), String>| {
                helpers.borrow_mut().remove(&key);
                done(result);
            })),
        }));
        unsafe extern "C" fn clear_ready(
            _source: *mut glib::gobject_ffi::GObject,
            result: *mut gio::ffi::GAsyncResult,
            user_data: gpointer,
        ) {
            let request = Box::from_raw(user_data as *mut ClearRequest);
            let finish = request.finish.into_inner();
            let ok = webkit2gtk_sys::webkit_website_data_manager_clear_finish(
                request.manager,
                result,
                std::ptr::null_mut(),
            );
            let outcome = if ok != GFALSE {
                Ok(())
            } else {
                Err("The browser profile data could not be cleared.".into())
            };
            finish(outcome);
        }
        webkit2gtk_sys::webkit_website_data_manager_clear(
            manager_ptr,
            types.into_glib(),
            0,
            std::ptr::null_mut(),
            Some(clear_ready as GAsyncReadyCallback),
            request as gpointer,
        );
    }

    pub fn set_cookies(
        &mut self,
        store: &BrowserHostStore,
        cookies: &[BrowserHostCookie],
        window: &impl HasWindowHandle,
        done: impl FnOnce(Result<Vec<bool>, String>) + 'static,
    ) {
        if cookies.is_empty() {
            return done(Ok(Vec::new()));
        }
        let (manager, key) = match self.data_manager(store, window) {
            Ok(found) => found,
            Err(error) => return done(Err(error)),
        };
        let Some(cookie_manager) = manager.cookie_manager() else {
            self.helpers.borrow_mut().remove(&key);
            return done(Err(
                "The browser profile's cookie store is unavailable.".into()
            ));
        };
        let helpers = self.helpers.clone();
        let writes = Rc::new(RefCell::new(CookieWrites {
            written: vec![false; cookies.len()],
            remaining: cookies.len(),
            done: Some(Box::new(move |result| {
                helpers.borrow_mut().remove(&key);
                done(result);
            })),
        }));
        for (index, cookie) in cookies.iter().enumerate() {
            let Some(mut soup_cookie) = soup_cookie(cookie) else {
                finish_cookie(&writes, index, false);
                continue;
            };
            let writes = writes.clone();
            cookie_manager.add_cookie(
                &mut soup_cookie,
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| finish_cookie(&writes, index, result.is_ok()),
            );
        }
    }
}
