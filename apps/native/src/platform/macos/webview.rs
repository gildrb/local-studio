use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool};
use objc2::{MainThreadMarker, available, msg_send, sel};
use objc2_app_kit::{
    NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSBitmapImageFileType,
    NSBitmapImageRep, NSImage,
};
use objc2_foundation::{
    NSDate, NSDictionary, NSError, NSHTTPCookie, NSHTTPCookieDiscard, NSHTTPCookieDomain,
    NSHTTPCookieExpires, NSHTTPCookieName, NSHTTPCookiePath, NSHTTPCookiePropertyKey,
    NSHTTPCookieSecure, NSHTTPCookieValue, NSHTTPCookieVersion, NSMutableDictionary, NSNumber,
    NSSet, NSString, NSUUID, ns_string,
};
use objc2_web_kit::{
    WKSnapshotConfiguration, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
    WKWebsiteDataTypeCookies, WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeIndexedDBDatabases,
    WKWebsiteDataTypeLocalStorage, WKWebsiteDataTypeMemoryCache,
    WKWebsiteDataTypeServiceWorkerRegistrations,
};
use wry::raw_window_handle::HasWindowHandle;
use wry::{WebViewBuilder, WebViewBuilderExtDarwin, WebViewBuilderExtMacos, WebViewExtMacOS};

use crate::app_core::views::browser::{BrowserHostCookie, BrowserHostStore};

const STORE_ID_BYTES: usize = 16;
const MAIN_THREAD_ERROR: &str = "Browser data can only be changed on the main thread.";

const AUDIO_MUTED_STATE: usize = 1;

fn web_view(view: &wry::WebView) -> Retained<WKWebView> {
    Retained::into_super(view.webview())
}

pub fn set_color_scheme(view: &wry::WebView, scheme: &str) {
    let web_view = web_view(view);
    let appearance = match scheme {
        "dark" => NSAppearance::appearanceNamed(unsafe { NSAppearanceNameDarkAqua }),
        "light" => NSAppearance::appearanceNamed(unsafe { NSAppearanceNameAqua }),
        _ => None,
    };
    let _: () = unsafe { msg_send![&*web_view, setAppearance: appearance.as_deref()] };
}

pub fn set_audio_muted(view: &wry::WebView, muted: bool) {
    let web_view = web_view(view);
    let object: &AnyObject = &web_view;
    let responds: Bool = unsafe { msg_send![object, respondsToSelector: sel!(_setPageMuted:)] };
    if responds.as_bool() {
        let state = if muted { AUDIO_MUTED_STATE } else { 0 };
        let _: () = unsafe { msg_send![object, _setPageMuted: state] };
    }
}

pub fn hard_reload(view: &wry::WebView) {
    let _ = unsafe { web_view(view).reloadFromOrigin() };
}

pub fn stop_loading(view: &wry::WebView) {
    unsafe { web_view(view).stopLoading() };
}

pub fn set_corner_radius(view: &wry::WebView, radius: f32) {
    let web_view = web_view(view);
    web_view.setWantsLayer(true);
    let object: &AnyObject = &web_view;
    let layer: *mut AnyObject = unsafe { msg_send![object, layer] };
    let Some(layer) = (unsafe { layer.as_ref() }) else {
        return;
    };
    let _: () = unsafe { msg_send![layer, setCornerRadius: f64::from(radius)] };
    let _: () = unsafe { msg_send![layer, setMasksToBounds: Bool::new(radius > 0.)] };
}

pub struct Snapshot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub fn snapshot(
    view: &wry::WebView,
    max_width: f64,
    done: impl FnOnce(Result<Snapshot, String>) + 'static,
) {
    let Some(mtm) = MainThreadMarker::new() else {
        done(Err("Snapshots must start on the main thread.".into()));
        return;
    };
    let web_view = web_view(view);
    let frame_width = web_view.frame().size.width;
    let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
    let width = NSNumber::new_f64(frame_width.min(max_width).max(1.));
    unsafe { configuration.setSnapshotWidth(Some(&width)) };
    let done = RefCell::new(Some(done));
    let block = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let Some(done) = done.borrow_mut().take() else {
            return;
        };
        let image = unsafe { image.as_ref() };
        let Some(image) = image else {
            let message = unsafe { error.as_ref() }
                .map(|error| error.localizedDescription().to_string())
                .unwrap_or_else(|| "The page could not be captured.".into());
            done(Err(message));
            return;
        };
        done(encode_png(image));
    });
    unsafe {
        web_view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &block)
    };
}

fn encode_png(image: &NSImage) -> Result<Snapshot, String> {
    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "The captured page had no image data.".to_string())?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "The captured page could not be decoded.".to_string())?;
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or_else(|| "The captured page could not be encoded as PNG.".to_string())?;
    Ok(Snapshot {
        png: png.to_vec(),
        width: u32::try_from(rep.pixelsWide()).unwrap_or(0),
        height: u32::try_from(rep.pixelsHigh()).unwrap_or(0),
    })
}

#[derive(Clone, Copy)]
pub enum StoreData {
    Cookies,
    Cache,
}

fn store_identifier(id: &str) -> Result<[u8; STORE_ID_BYTES], String> {
    let invalid = || format!("Invalid browser profile store id: {id}");
    if id.len() != STORE_ID_BYTES * 2 {
        return Err(invalid());
    }
    let mut bytes = [0u8; STORE_ID_BYTES];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = id
            .get(index * 2..index * 2 + 2)
            .and_then(|pair| u8::from_str_radix(pair, 16).ok())
            .ok_or_else(invalid)?;
    }
    Ok(bytes)
}

fn http_cookie(cookie: &BrowserHostCookie) -> Option<Retained<NSHTTPCookie>> {
    let name = NSString::from_str(&cookie.name);
    let value = NSString::from_str(&cookie.value);
    let path = NSString::from_str(&cookie.path);
    let domain = NSString::from_str(&cookie.domain);
    let properties: Retained<NSMutableDictionary<NSHTTPCookiePropertyKey, AnyObject>> =
        NSMutableDictionary::from_slices(
            &[
                unsafe { NSHTTPCookieName },
                unsafe { NSHTTPCookieValue },
                unsafe { NSHTTPCookiePath },
                unsafe { NSHTTPCookieDomain },
            ],
            &[&*name, &*value, &*path, &*domain],
        );
    match cookie.expires {
        Some(seconds) => {
            let expires = NSDate::dateWithTimeIntervalSince1970(seconds);
            properties.insert(unsafe { NSHTTPCookieExpires }, &*expires);
            properties.insert(unsafe { NSHTTPCookieVersion }, ns_string!("0"));
        }
        None => properties.insert(unsafe { NSHTTPCookieDiscard }, ns_string!("TRUE")),
    }
    if cookie.secure {
        properties.insert(unsafe { NSHTTPCookieSecure }, ns_string!("TRUE"));
    }
    if cookie.http_only {
        properties.insert(ns_string!("HttpOnly"), ns_string!("TRUE"));
    }
    match cookie.same_site.as_deref() {
        Some("lax") => properties.insert(ns_string!("SameSite"), ns_string!("lax")),
        Some("strict") => properties.insert(ns_string!("SameSite"), ns_string!("strict")),
        _ => {}
    }
    unsafe { NSHTTPCookie::cookieWithProperties(&properties) }
}

type CookieWritesDone = Box<dyn FnOnce(Result<Vec<bool>, String>)>;

struct CookieWrites {
    written: Vec<bool>,
    remaining: usize,
    done: Option<CookieWritesDone>,
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

#[derive(Default)]
pub struct ProfileStores {
    ephemeral: HashMap<String, Retained<WKWebsiteDataStore>>,
}

impl ProfileStores {
    fn ephemeral_store(&mut self, id: &str, mtm: MainThreadMarker) -> Retained<WKWebsiteDataStore> {
        self.ephemeral
            .entry(id.to_string())
            .or_insert_with(|| unsafe { WKWebsiteDataStore::nonPersistentDataStore(mtm) })
            .clone()
    }

    fn data_store(
        &mut self,
        store: &BrowserHostStore,
    ) -> Result<Retained<WKWebsiteDataStore>, String> {
        let mtm = MainThreadMarker::new().ok_or_else(|| MAIN_THREAD_ERROR.to_string())?;
        if !store.persistent {
            return Ok(self.ephemeral_store(&store.id, mtm));
        }
        if !available!(macos = 14.0) {
            return Ok(unsafe { WKWebsiteDataStore::defaultDataStore(mtm) });
        }
        let identifier = NSUUID::from_bytes(store_identifier(&store.id)?);
        Ok(unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&identifier, mtm) })
    }

    pub fn builder<'a>(
        &'a mut self,
        store: &BrowserHostStore,
    ) -> Result<WebViewBuilder<'a>, String> {
        if store.persistent {
            return Ok(
                WebViewBuilder::new().with_data_store_identifier(store_identifier(&store.id)?)
            );
        }
        let mtm = MainThreadMarker::new().ok_or_else(|| MAIN_THREAD_ERROR.to_string())?;
        let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
        let data_store = self.ephemeral_store(&store.id, mtm);
        unsafe { configuration.setWebsiteDataStore(&data_store) };
        Ok(WebViewBuilder::new().with_webview_configuration(configuration))
    }

    pub fn clear(
        &mut self,
        store: &BrowserHostStore,
        data: StoreData,
        _window: &impl HasWindowHandle,
        done: impl FnOnce(Result<(), String>) + 'static,
    ) {
        let data_store = match self.data_store(store) {
            Ok(data_store) => data_store,
            Err(error) => return done(Err(error)),
        };
        let types: Retained<NSSet<NSString>> = match data {
            StoreData::Cookies => NSSet::from_slice(&[
                unsafe { WKWebsiteDataTypeCookies },
                unsafe { WKWebsiteDataTypeLocalStorage },
                unsafe { WKWebsiteDataTypeIndexedDBDatabases },
                unsafe { WKWebsiteDataTypeServiceWorkerRegistrations },
            ]),
            StoreData::Cache => {
                NSSet::from_slice(&[unsafe { WKWebsiteDataTypeDiskCache }, unsafe {
                    WKWebsiteDataTypeMemoryCache
                }])
            }
        };
        let since = NSDate::dateWithTimeIntervalSince1970(0.);
        let done = RefCell::new(Some(done));
        let block = RcBlock::new(move || {
            if let Some(done) = done.borrow_mut().take() {
                done(Ok(()));
            }
        });
        unsafe {
            data_store.removeDataOfTypes_modifiedSince_completionHandler(&types, &since, &block)
        };
    }

    pub fn set_cookies(
        &mut self,
        store: &BrowserHostStore,
        cookies: &[BrowserHostCookie],
        _window: &impl HasWindowHandle,
        done: impl FnOnce(Result<Vec<bool>, String>) + 'static,
    ) {
        let data_store = match self.data_store(store) {
            Ok(data_store) => data_store,
            Err(error) => return done(Err(error)),
        };
        if cookies.is_empty() {
            return done(Ok(Vec::new()));
        }
        let cookie_store = unsafe { data_store.httpCookieStore() };
        let writes = Rc::new(RefCell::new(CookieWrites {
            written: vec![false; cookies.len()],
            remaining: cookies.len(),
            done: Some(Box::new(done)),
        }));
        for (index, cookie) in cookies.iter().enumerate() {
            let Some(http_cookie) = http_cookie(cookie) else {
                finish_cookie(&writes, index, false);
                continue;
            };
            let writes = writes.clone();
            let block = RcBlock::new(move || finish_cookie(&writes, index, true));
            unsafe { cookie_store.setCookie_completionHandler(&http_cookie, Some(&block)) };
        }
    }
}
