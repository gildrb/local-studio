use std::cell::RefCell;
use std::sync::OnceLock;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, MainThreadMarker, define_class, msg_send};
use objc2_app_kit::{NSApplication, NSSound};
use objc2_foundation::{NSArray, NSBundle, NSData, NSError, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSettings,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

use crate::platform::notifications::{ClickHandler, Permission, PermissionCallback};

static ON_CLICK: OnceLock<ClickHandler> = OnceLock::new();

thread_local! {
    static DELEGATE: RefCell<Option<Retained<Delegate>>> = const { RefCell::new(None) };
    static SOUNDS: RefCell<Vec<Retained<NSSound>>> = const { RefCell::new(Vec::new()) };
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "LocalStudioNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &block2::DynBlock<dyn Fn()>,
        ) {
            let tag = response.notification().request().identifier().to_string();
            if let Some(on_click) = ON_CLICK.get() {
                on_click(tag);
            }
            completion.call(());
        }
    }
);

fn center() -> Option<Retained<UNUserNotificationCenter>> {
    NSBundle::mainBundle().bundleIdentifier()?;
    Some(UNUserNotificationCenter::currentNotificationCenter())
}

pub fn init(on_click: ClickHandler) {
    let _ = ON_CLICK.set(on_click);
    let Some(center) = center() else {
        return;
    };
    let delegate: Retained<Delegate> = unsafe { msg_send![Delegate::alloc(), init] };
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    DELEGATE.with(|slot| *slot.borrow_mut() = Some(delegate));
}

fn status(settings: &UNNotificationSettings) -> Permission {
    let status = settings.authorizationStatus();
    if status == UNAuthorizationStatus::NotDetermined {
        Permission::Default
    } else if status == UNAuthorizationStatus::Denied {
        Permission::Denied
    } else {
        Permission::Granted
    }
}

pub fn authorization(done: PermissionCallback) {
    let Some(center) = center() else {
        done(Permission::Error);
        return;
    };
    let done = std::sync::Mutex::new(Some(done));
    let block = RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
        let permission = status(unsafe { settings.as_ref() });
        if let Some(done) = done.lock().ok().and_then(|mut slot| slot.take()) {
            done(permission);
        }
    });
    center.getNotificationSettingsWithCompletionHandler(&block);
}

pub fn request_permission(done: PermissionCallback) {
    let Some(center) = center() else {
        done(Permission::Error);
        return;
    };
    let done = std::sync::Mutex::new(Some(done));
    let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
        let permission = if !error.is_null() {
            Permission::Error
        } else if granted.as_bool() {
            Permission::Granted
        } else {
            Permission::Denied
        };
        if let Some(done) = done.lock().ok().and_then(|mut slot| slot.take()) {
            done(permission);
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Badge,
        &block,
    );
}

pub fn post(tag: &str, title: &str, body: &str) {
    let Some(center) = center() else {
        return;
    };
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(title));
    content.setBody(&NSString::from_str(body));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(tag),
        &content,
        None,
    );
    center.addNotificationRequest_withCompletionHandler(&request, None);
}

pub fn remove(tags: &[String]) {
    let Some(center) = center() else {
        return;
    };
    let identifiers: Vec<Retained<NSString>> =
        tags.iter().map(|tag| NSString::from_str(tag)).collect();
    let identifiers = NSArray::from_retained_slice(&identifiers);
    center.removeDeliveredNotificationsWithIdentifiers(&identifiers);
    center.removePendingNotificationRequestsWithIdentifiers(&identifiers);
}

pub fn set_badge(count: usize) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let label = (count > 0).then(|| NSString::from_str(&count.to_string()));
    NSApplication::sharedApplication(mtm)
        .dockTile()
        .setBadgeLabel(label.as_deref());
}

pub fn play(bytes: &'static [u8]) {
    let data = NSData::with_bytes(bytes);
    let Some(sound) = NSSound::initWithData(NSSound::alloc(), &data) else {
        return;
    };
    sound.play();
    SOUNDS.with(|sounds| {
        let mut sounds = sounds.borrow_mut();
        sounds.retain(|sound| sound.isPlaying());
        sounds.push(sound);
    });
}
