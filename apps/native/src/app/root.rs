use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AppContext, Context, Entity, FollowMode, InteractiveElement, IntoElement, ListAlignment,
    ListState, ParentElement, Render, SharedString, Styled, Window, WindowAppearance, div, px,
};
use serde_json::json;

use crate::app::app_sidebar_layout::{AppSidebarLayout, controls_left};
use crate::app::core_toasts::CoreToasts;
use crate::app::pages;
use crate::app_core::backend::{self, CoreProcess, ServerInfo};
use crate::app_core::client::{CoreClient, Hello, ViewState};
use crate::app_core::views::app_shell::AppShellView;
use crate::app_core::views::composer::ComposerView;
use crate::app_core::views::header_toolbar::HeaderToolbarView;
use crate::app_core::views::model_picker::ModelPickerView;
use crate::app_core::views::open_in::OpenInView;
use crate::app_core::views::sidebar::SidebarView;
use crate::app_core::views::timeline::{TimelineRow, TimelineView};
use crate::app_core::views::toasts::ToastsView;
use crate::features::chat::chat_composer::{ChatComposer, ComposerMenuState};
use crate::features::chat::chat_view::ChatView;
use crate::features::chat::composer_input::ComposerInput;
use crate::features::chat::open_in_picker;
use crate::features::right_panel::panel::RightPanel;
use crate::features::sidebar::Sidebar;
use crate::features::sidebar::sidebar_chrome::titlebar_content_left;
use crate::platform::{PLATFORM, UI_FONT};
use crate::ui::sidebar::SidebarState;
use crate::ui::theme;
use std::rc::Rc;

const STATUS_TEXT: f32 = 13.;
const COMPOSER_MAX_ROWS: usize = 8;
const TIMELINE_OVERDRAW: f32 = 800.;

pub struct Connected {
    pub(crate) client: Entity<CoreClient>,
    pub(crate) shell: Entity<ViewState<AppShellView>>,
    pub(crate) sidebar: Entity<ViewState<SidebarView>>,
    pub(crate) timeline: Entity<ViewState<TimelineView>>,
    pub(crate) timeline_list: ListState,
    pub(crate) timeline_rows: Rc<Vec<TimelineRow>>,
    pub(crate) composer: Entity<ViewState<Option<ComposerView>>>,
    pub(crate) toasts: Entity<ViewState<ToastsView>>,
    pub(crate) composer_editor: Option<Entity<TextareaState>>,
    pub(crate) composer_menus: Entity<ComposerMenuState>,
    pub(crate) composer_input: Option<Entity<ComposerInput>>,
    pub(crate) composer_thread: Option<String>,
    pub(crate) composer_placeholder: String,
    pub(crate) composer_prompt_revision: u64,
    pub(crate) model_picker: Entity<ViewState<Option<ModelPickerView>>>,
    pub(crate) header_toolbar: Entity<ViewState<Option<HeaderToolbarView>>>,
    pub(crate) open_in: Entity<ViewState<OpenInView>>,
    pub(crate) model_picker_search: Option<Entity<InputState>>,
    pub(crate) model_picker_open: bool,
    pub(crate) right_panel: Entity<RightPanel>,
    pub(crate) terminal_drawer: Entity<crate::features::terminal::TerminalSurface>,
    pub(crate) settings_page: Entity<crate::features::settings::SettingsPage>,
    pub(crate) settings_nav: Entity<crate::features::settings::SettingsNav>,
    pub(crate) pull_requests_page: Entity<crate::features::pull_requests::PullRequestsPage>,
    pub(crate) usage_page: Entity<crate::features::usage::UsagePage>,
    pub(crate) onboarding: Entity<crate::features::onboarding::OnboardingHost>,
    pub(crate) _app_theme: Entity<ViewState<crate::app_core::views::app_theme::AppThemeView>>,
    pub(crate) _app_appearance:
        Entity<ViewState<crate::app_core::views::app_theme::AppAppearanceView>>,
    pub(crate) _app_relaunch:
        Entity<ViewState<crate::app_core::views::settings_connections::AppRelaunchView>>,
    pub(crate) _app_quit_for_update:
        Entity<ViewState<crate::app_core::views::settings_connections::AppRelaunchView>>,
}

enum Phase {
    Starting,
    Failed(SharedString),
    Connected(Box<Connected>),
}

pub struct AppRoot {
    phase: Phase,
    sidebar: SidebarState,
    window: gpui::AnyWindowHandle,
}

fn appearance_name(appearance: WindowAppearance) -> &'static str {
    match appearance {
        WindowAppearance::Light | WindowAppearance::VibrantLight => "light",
        WindowAppearance::Dark | WindowAppearance::VibrantDark => "dark",
    }
}

fn launch() -> Result<(Option<ServerInfo>, CoreProcess, String), String> {
    let runtime = backend::runtime()?;
    let home = backend::t3_home();
    let settings = backend::desktop_launch_settings(&home);
    let server = if settings.local_environment_enabled {
        Some(backend::start_server(&runtime, &home, &settings)?)
    } else {
        std::fs::create_dir_all(&home)
            .map_err(|error| format!("cannot create {}: {error}", home.display()))?;
        None
    };
    let core = backend::start_core(&runtime)?;
    Ok((server, core, home.to_string_lossy().into_owned()))
}

fn report_system_appearance(client: &Entity<CoreClient>, cx: &mut Context<AppRoot>) {
    let appearance = match theme::system_appearance(cx) {
        theme::Appearance::Light => "light",
        theme::Appearance::Dark => "dark",
    };
    client.update(cx, |client, _| {
        client.act(
            "appSetSystemAppearance",
            json!({ "appearance": appearance }),
        )
    });
}

fn apply_app_theme(
    view: &crate::app_core::views::app_theme::AppThemeView,
    cx: &mut Context<AppRoot>,
) {
    use crate::app_core::views::app_theme::AppThemeAppearance;
    let appearance = match view.appearance {
        AppThemeAppearance::Light => theme::Appearance::Light,
        AppThemeAppearance::Dark => theme::Appearance::Dark,
    };
    let palette = view.palette.as_ref().map(|palette| theme::ThemePalette {
        id: palette.theme_id.clone(),
        colors: palette
            .colors
            .iter()
            .filter_map(|(role, value)| {
                theme::color::parse_hex(value).map(|color| (role.clone(), color))
            })
            .collect(),
    });
    theme::set_app_theme(appearance, palette, cx);
}

impl AppRoot {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let appearance = appearance_name(window.appearance());
        let (sender, receiver) = futures::channel::oneshot::channel();
        std::thread::spawn(move || {
            let _ = sender.send(launch());
        });
        cx.spawn(async move |this, cx| {
            let outcome = receiver
                .await
                .unwrap_or_else(|_| Err("startup thread ended without a result".into()));
            let _ = this.update(cx, |root, cx| root.started(outcome, appearance, cx));
        })
        .detach();
        cx.observe_window_appearance(window, |root, window, cx| {
            theme::system_changed(window.appearance(), cx);
            if let Phase::Connected(connected) = &root.phase {
                report_system_appearance(&connected.client, cx);
            }
        })
        .detach();
        Self {
            phase: Phase::Starting,
            sidebar: SidebarState::default(),
            window: window.window_handle(),
        }
    }

    fn started(
        &mut self,
        outcome: Result<(Option<ServerInfo>, CoreProcess, String), String>,
        appearance: &str,
        cx: &mut Context<Self>,
    ) {
        let (server, core, home) = match outcome {
            Ok(started) => started,
            Err(error) => {
                eprintln!("startup failed: {error}");
                self.phase = Phase::Failed(error.into());
                cx.notify();
                return;
            }
        };
        let client = CoreClient::start(
            core,
            Hello {
                server: server.as_ref(),
                t3_home: &home,
                platform: PLATFORM,
                appearance,
            },
            cx,
        );
        report_system_appearance(&client, cx);
        let app_theme = CoreClient::subscribe::<crate::app_core::views::app_theme::AppThemeView>(
            &client,
            "appTheme",
            json!({}),
            cx,
        );
        cx.observe(&app_theme, |_, view, cx| {
            if let Some(view) = view.read(cx).data.clone() {
                apply_app_theme(&view, cx);
                cx.refresh_windows();
            }
        })
        .detach();
        let app_appearance = crate::app::app_appearance::subscribe(&client, self.window, cx);
        let app_relaunch = CoreClient::subscribe::<
            crate::app_core::views::settings_connections::AppRelaunchView,
        >(&client, "appRelaunch", json!({}), cx);
        cx.observe(&app_relaunch, |_, view, cx| {
            if view
                .read(cx)
                .data
                .as_ref()
                .is_some_and(|view| view.revision > 0)
            {
                std::thread::spawn(backend::relaunch);
            }
        })
        .detach();
        let app_quit_for_update = CoreClient::subscribe::<
            crate::app_core::views::settings_connections::AppRelaunchView,
        >(&client, "appQuitForUpdate", json!({}), cx);
        cx.observe(&app_quit_for_update, |_, view, cx| {
            if view
                .read(cx)
                .data
                .as_ref()
                .is_some_and(|view| view.revision > 0)
            {
                cx.quit();
            }
        })
        .detach();
        let shell = CoreClient::subscribe::<AppShellView>(&client, "app-shell", json!({}), cx);
        let sidebar = CoreClient::subscribe::<SidebarView>(&client, "sidebar", json!({}), cx);
        cx.observe(&shell, |_, _, cx| cx.notify()).detach();
        cx.observe(&sidebar, |_, _, cx| cx.notify()).detach();
        let timeline = CoreClient::subscribe::<TimelineView>(&client, "timeline", json!({}), cx);
        let timeline_list = ListState::new(0, ListAlignment::Top, px(TIMELINE_OVERDRAW));
        timeline_list.set_follow_mode(FollowMode::Tail);
        let list = timeline_list.clone();
        let mut shown_thread: Option<String> = None;
        let mut scroll_revision = 0;
        cx.observe(&timeline, move |root, timeline, cx| {
            let Some(view) = timeline.read(cx).data.clone() else {
                return;
            };
            let Phase::Connected(connected) = &mut root.phase else {
                return;
            };
            let previous = connected.timeline_rows.clone();
            let rows = view.rows;
            if view.thread_key != shown_thread {
                shown_thread = view.thread_key;
                scroll_revision = view.scroll_revision;
                list.reset(rows.len());
                list.set_follow_mode(FollowMode::Tail);
            } else {
                let unchanged = previous
                    .iter()
                    .zip(rows.iter())
                    .take_while(|(before, after)| before == after)
                    .count();
                if unchanged != previous.len() || unchanged != rows.len() {
                    list.splice(unchanged..previous.len(), rows.len() - unchanged);
                }
                if view.scroll_revision != scroll_revision {
                    scroll_revision = view.scroll_revision;
                    list.set_follow_mode(FollowMode::Tail);
                    list.scroll_to_end();
                }
            }
            connected.timeline_rows = Rc::new(rows);
            cx.notify();
        })
        .detach();
        cx.observe(&client, |_, _, cx| cx.notify()).detach();
        let composer =
            CoreClient::subscribe::<Option<ComposerView>>(&client, "composer", json!({}), cx);
        let composer_menus = cx.new(|_| ComposerMenuState::default());
        let toasts = CoreClient::subscribe::<ToastsView>(&client, "toasts", json!({}), cx);
        cx.observe(&toasts, |_, _, cx| cx.notify()).detach();
        cx.observe(&composer_menus, |_, _, cx| cx.notify()).detach();
        let model_picker =
            CoreClient::subscribe::<Option<ModelPickerView>>(&client, "modelPicker", json!({}), cx);
        let header_toolbar = CoreClient::subscribe::<Option<HeaderToolbarView>>(
            &client,
            "headerToolbar",
            json!({}),
            cx,
        );
        cx.observe(&header_toolbar, |_, _, cx| cx.notify()).detach();
        let open_in = CoreClient::subscribe::<OpenInView>(&client, "openIn", json!({}), cx);
        let url_client = client.clone();
        let mut handled_url = None;
        cx.observe(&open_in, move |_, view, cx| {
            let view = view.read(cx).data.clone();
            open_in_picker::service_url_request(view.as_ref(), &mut handled_url, &url_client, cx);
            cx.notify();
        })
        .detach();
        let panel_client = client.clone();
        let right_panel = cx.new(|cx| RightPanel::new(panel_client, cx));
        cx.observe(&right_panel, |_, _, cx| cx.notify()).detach();
        let terminal_drawer =
            crate::features::terminal::TerminalSurface::drawer(client.clone(), cx);
        cx.observe(&terminal_drawer, |_, _, cx| cx.notify())
            .detach();
        let settings_page =
            cx.new(|cx| crate::features::settings::SettingsPage::new(client.clone(), cx));
        cx.observe(&settings_page, |_, _, cx| cx.notify()).detach();
        let settings_nav = cx.new(|cx| {
            crate::features::settings::SettingsNav::new(
                client.clone(),
                sidebar.clone(),
                settings_page.clone(),
                cx,
            )
        });
        cx.observe(&settings_nav, |_, _, cx| cx.notify()).detach();
        let pull_requests_page = cx.new(|cx| {
            crate::features::pull_requests::PullRequestsPage::new(
                client.clone(),
                right_panel.clone(),
                cx,
            )
        });
        cx.observe(&pull_requests_page, |_, _, cx| cx.notify())
            .detach();
        let usage_page = cx.new(|cx| crate::features::usage::UsagePage::new(client.clone(), cx));
        cx.observe(&usage_page, |_, _, cx| cx.notify()).detach();
        let onboarding =
            cx.new(|cx| crate::features::onboarding::OnboardingHost::new(client.clone(), cx));
        cx.observe(&onboarding, |_, _, cx| cx.notify()).detach();
        self.phase = Phase::Connected(Box::new(Connected {
            client,
            shell,
            sidebar,
            timeline,
            timeline_list,
            timeline_rows: Rc::new(Vec::new()),
            composer,
            toasts,
            composer_editor: None,
            composer_menus,
            composer_input: None,
            composer_thread: None,
            composer_placeholder: String::new(),
            composer_prompt_revision: 0,
            model_picker,
            header_toolbar,
            open_in,
            model_picker_search: None,
            model_picker_open: false,
            right_panel,
            terminal_drawer,
            settings_page,
            settings_nav,
            pull_requests_page,
            usage_page,
            onboarding,
            _app_theme: app_theme,
            _app_appearance: app_appearance,
            _app_relaunch: app_relaunch,
            _app_quit_for_update: app_quit_for_update,
        }));
        cx.notify();
    }
}

impl AppRoot {
    fn ensure_composer_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Phase::Connected(connected) = &mut self.phase else {
            return;
        };
        if connected.composer_editor.is_some() {
            return;
        }
        let editor = cx.new(|cx| {
            TextareaState::new(window, cx)
                .auto_grow(1, COMPOSER_MAX_ROWS)
                .submit_on_enter(true)
        });
        let client = connected.client.clone();
        cx.subscribe_in(
            &editor,
            window,
            move |_, editor: &Entity<TextareaState>, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let prompt = editor.read(cx).value().to_string();
                    client.update(cx, |client, _| {
                        client.act("setPrompt", json!({ "prompt": prompt }))
                    });
                }
                InputEvent::PressEnter {
                    secondary: false,
                    shift: false,
                } => client.update(cx, |client, _| client.act("send", json!({}))),
                _ => {}
            },
        )
        .detach();
        cx.observe_in(&connected.composer, window, |root, _, window, cx| {
            root.sync_composer(window, cx);
        })
        .detach();
        let client = connected.client.clone();
        let composer_input = cx.new(|cx| ComposerInput::new(client, editor.clone(), window, cx));
        cx.observe(&composer_input, |_, _, cx| cx.notify()).detach();
        connected.composer_input = Some(composer_input);
        connected.composer_editor = Some(editor);
        crate::features::chat::git_actions_host::GitActionsHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) = crate::features::chat::git_actions_host::GitActionsHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::onboarding::codex_setup::CodexSetupHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) = crate::features::onboarding::codex_setup::CodexSetupHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::device::setup::DeviceSetupHost::install(&connected.client, cx);
        crate::features::chat::project_scripts_host::ProjectScriptsHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) =
            crate::features::chat::project_scripts_host::ProjectScriptsHost::global(cx)
        {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::chat::thread_interactions_host::ThreadInteractionsHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) =
            crate::features::chat::thread_interactions_host::ThreadInteractionsHost::global(cx)
        {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::command_palette::CommandPaletteHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) = crate::features::command_palette::CommandPaletteHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::drafts_host::DraftsHost::install(&connected.client, window, cx);
        if let Some(host) = crate::features::drafts_host::DraftsHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::platform::native_context_menu::NativeContextMenuHost::install(
            &connected.client,
            window,
            cx,
        );
        crate::app::thread_notifications::ThreadNotificationsHost::install(
            &connected.client,
            window,
            cx,
        );
        crate::features::snap_shot::SnapShotHost::install(&connected.client, window, cx);
        crate::features::browser::host::BrowserHost::install(&connected.client, window, cx);
        crate::features::sidebar::sidebar_rows_host::SidebarRowsHost::install(
            &connected.client,
            window,
            cx,
        );
        crate::features::chat::thread_title::ThreadTitleHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) = crate::features::chat::thread_title::ThreadTitleHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::chat::custom_snooze_dialog::CustomSnoozeHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) =
            crate::features::chat::custom_snooze_dialog::CustomSnoozeHost::global(cx)
        {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::app::confirm_dialog::ConfirmDialogHost::install(&connected.client, window, cx);
        if let Some(host) = crate::app::confirm_dialog::ConfirmDialogHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::ui::image_viewer::MediaViewerHost::install(&connected.client, window, cx);
        if let Some(host) = crate::ui::image_viewer::MediaViewerHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::ssh_password_dialog::SshPasswordHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) = crate::features::ssh_password_dialog::SshPasswordHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::theme_editor::ThemeEditorHost::install(&connected.client, window, cx);
        if let Some(host) = crate::features::theme_editor::ThemeEditorHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        crate::features::chat::branch_toolbar::BranchToolbarHost::install(
            &connected.client,
            window,
            cx,
        );
        if let Some(host) = crate::features::chat::branch_toolbar::BranchToolbarHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        let search = cx.new(|cx| InputState::new(window, cx));
        let client = connected.client.clone();
        cx.subscribe_in(
            &search,
            window,
            move |_, search: &Entity<InputState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let query = search.read(cx).value().to_string();
                    client.update(cx, |client, _| {
                        client.act("modelPickerSearch", json!({ "query": query }))
                    });
                }
            },
        )
        .detach();
        cx.observe_in(&connected.model_picker, window, |root, _, window, cx| {
            root.sync_model_picker(window, cx);
        })
        .detach();
        connected.model_picker_search = Some(search);
        self.sync_composer(window, cx);
    }

    fn sync_model_picker(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Phase::Connected(connected) = &mut self.phase else {
            return;
        };
        let Some(search) = connected.model_picker_search.clone() else {
            return;
        };
        let placeholder = connected
            .model_picker
            .read(cx)
            .data
            .as_ref()
            .and_then(Option::as_ref)
            .map(|view| view.search_placeholder.clone());
        let open = placeholder.is_some();
        let opened = open && !connected.model_picker_open;
        connected.model_picker_open = open;
        if let Some(placeholder) = placeholder.filter(|_| opened) {
            search.update(cx, |state, cx| {
                state.set_value("", window, cx);
                state.set_placeholder(placeholder, window, cx);
                state.focus(window, cx);
            });
        } else if !open && let Some(editor) = connected.composer_editor.clone() {
            editor.update(cx, |state, cx| state.focus(window, cx));
        }
        cx.notify();
    }

    fn sync_composer(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Phase::Connected(connected) = &mut self.phase else {
            return;
        };
        let Some(editor) = connected.composer_editor.clone() else {
            return;
        };
        let Some(view) = connected.composer.read(cx).data.clone().flatten() else {
            return;
        };
        let thread_changed = view.thread_key != connected.composer_thread;
        let placeholder_changed = view.placeholder != connected.composer_placeholder;
        let prompt_rewritten = view.prompt_revision != connected.composer_prompt_revision;
        if !thread_changed && !placeholder_changed && !prompt_rewritten {
            return;
        }
        connected.composer_thread = view.thread_key.clone();
        connected.composer_placeholder = view.placeholder.clone();
        connected.composer_prompt_revision = view.prompt_revision;
        let reset_prompt = (thread_changed || prompt_rewritten).then(|| view.prompt.clone());
        editor.update(cx, |state, cx| {
            if let Some(prompt) = reset_prompt.clone() {
                state.set_value(prompt, window, cx);
            }
            state.set_placeholder(view.placeholder.clone(), window, cx);
        });
        if let (Some(prompt), Some(input)) = (reset_prompt, connected.composer_input.clone()) {
            input.update(cx, |input, cx| input.prompt_reset(prompt, window, cx));
        }
    }
}

impl Render for AppRoot {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        cx.defer(crate::ui::overlay_bounds::commit_frame);
        self.ensure_composer_editor(window, cx);
        let t = theme::active(cx);
        let left = controls_left(window);
        let status = |text: SharedString| {
            div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .px(px(24.))
                .text_size(px(STATUS_TEXT))
                .text_color(t.muted_foreground)
                .child(text)
        };
        let collapsed_inset = (!self.sidebar.open).then(|| titlebar_content_left(left));
        if let Phase::Connected(connected) = &self.phase {
            connected
                .settings_page
                .update(cx, |page, _| page.collapsed_inset = collapsed_inset);
            connected
                .pull_requests_page
                .update(cx, |page, _| page.collapsed_inset = collapsed_inset);
            connected
                .usage_page
                .update(cx, |page, _| page.collapsed_inset = collapsed_inset);
            connected
                .onboarding
                .update(cx, |host, _| host.collapsed_inset = collapsed_inset);
        }
        let layout = AppSidebarLayout::new(self.sidebar.clone(), left).on_toggle(cx.listener(
            |root, _, _, cx| {
                root.sidebar.toggle();
                cx.notify();
            },
        ));
        let layout = match &self.phase {
            Phase::Starting => layout.main(status("Starting Local Studio…".into())),
            Phase::Failed(error) => layout.main(status(error.clone())),
            Phase::Connected(connected) => {
                let shell = connected.shell.read(cx).data.clone();
                let sidebar = connected.sidebar.read(cx).data.clone();
                let sidebar_stage = sidebar.as_ref().and_then(|view| view.header.stage_backdrop);
                let core_failure = connected
                    .client
                    .read(cx)
                    .status
                    .as_ref()
                    .filter(|status| status.phase == "failed")
                    .map(|status| status.detail.clone().unwrap_or_default());
                let failure = core_failure.or_else(|| {
                    shell.as_ref().and_then(|shell| {
                        (shell.connection.phase
                            == crate::app_core::views::app_shell::ConnectionPhase::Failed)
                            .then(|| shell.connection.detail.clone().unwrap_or_default())
                    })
                });
                let page_route = shell
                    .as_ref()
                    .map(|shell| shell.route.clone())
                    .filter(|route| !route.is_chat());
                let home = shell
                    .as_ref()
                    .filter(|shell| {
                        shell.route == crate::app_core::views::app_shell::AppShellRoute::Home
                    })
                    .and_then(|_| {
                        crate::features::drafts_host::DraftsHost::home_content(collapsed_inset, cx)
                    });
                layout
                    .stage_backdrop(
                        sidebar
                            .as_ref()
                            .is_some_and(|view| view.header.stage_backdrop.is_some()),
                    )
                    .map(|this| match (&page_route, sidebar) {
                        (
                            Some(crate::app_core::views::app_shell::AppShellRoute::Settings {
                                ..
                            }),
                            _,
                        ) => this.sidebar(connected.settings_nav.clone()),
                        (_, Some(view)) => {
                            this.sidebar(Sidebar::new(&view, connected.client.clone(), left))
                        }
                        (_, None) => this,
                    })
                    .map(|this| match failure {
                        Some(detail) => this.main(status(detail.into())),
                        None if page_route.is_some() => {
                            this.main(pages::page_content(page_route.as_ref(), connected, cx))
                        }
                        None if home.is_some() => this.main(
                            div()
                                .flex()
                                .flex_col()
                                .flex_1()
                                .min_w_0()
                                .min_h_0()
                                .children(home),
                        ),
                        None => this.main(
                            ChatView::new(
                                shell
                                    .as_ref()
                                    .and_then(|shell| shell.thread_header.as_ref()),
                                collapsed_inset,
                            )
                            .toolbar(
                                connected
                                    .header_toolbar
                                    .read(cx)
                                    .data
                                    .as_ref()
                                    .and_then(Option::as_ref),
                                connected.client.clone(),
                            )
                            .open_in(
                                connected
                                    .open_in
                                    .read(cx)
                                    .data
                                    .as_ref()
                                    .and_then(|view| view.picker.as_ref()),
                            )
                            .right_panel(Some(connected.right_panel.clone()))
                            .terminal_drawer(Some(connected.terminal_drawer.clone()))
                            .timeline(
                                connected
                                    .timeline
                                    .read(cx)
                                    .data
                                    .as_ref()
                                    .map(|_| connected.timeline_rows.clone()),
                                connected.client.clone(),
                                connected.timeline_list.clone(),
                            )
                            .composer(
                                connected
                                    .composer
                                    .read(cx)
                                    .data
                                    .as_ref()
                                    .and_then(Option::as_ref)
                                    .zip(connected.composer_editor.clone())
                                    .map(|(view, editor)| {
                                        let composer = ChatComposer::new(
                                            view,
                                            editor,
                                            connected.client.clone(),
                                            connected.composer_menus.clone(),
                                            sidebar_stage,
                                        );
                                        match connected.model_picker_search.clone() {
                                            Some(search) => composer.model_picker(
                                                connected
                                                    .model_picker
                                                    .read(cx)
                                                    .data
                                                    .as_ref()
                                                    .and_then(Option::as_ref),
                                                search,
                                            ),
                                            None => composer,
                                        }
                                        .hero(
                                            crate::features::drafts_host::DraftsHost::hero_headline(
                                                cx,
                                            ),
                                        )
                                        .input(connected.composer_input.clone())
                                    }),
                            ),
                        ),
                    })
            }
        };
        let toasts = match &self.phase {
            Phase::Connected(connected) => connected
                .toasts
                .read(cx)
                .data
                .as_ref()
                .filter(|view| !view.toasts.is_empty())
                .map(|view| CoreToasts::new(view, connected.client.clone())),
            _ => None,
        };
        let settings_client = match &self.phase {
            Phase::Connected(connected) => Some(connected.client.clone()),
            _ => None,
        };
        div()
            .size_full()
            .font_family(UI_FONT)
            .bg(t.background)
            .map(|this| {
                match match &self.phase {
                    Phase::Connected(connected) => {
                        crate::features::onboarding::OnboardingHost::gate_screen(
                            &connected.onboarding,
                            cx,
                        )
                    }
                    _ => None,
                } {
                    Some(gate) => this.child(gate),
                    None => this.child(layout),
                }
            })
            .children(toasts)
            .children(crate::features::chat::git_actions_host::GitActionsHost::global(cx))
            .children(crate::features::onboarding::codex_setup::CodexSetupHost::global(cx))
            .children(crate::features::chat::project_scripts_host::ProjectScriptsHost::global(cx))
            .children(
                crate::features::chat::thread_interactions_host::ThreadInteractionsHost::global(cx),
            )
            .children(crate::features::chat::custom_snooze_dialog::CustomSnoozeHost::global(cx))
            .children(crate::features::command_palette::CommandPaletteHost::global(cx))
            .children(crate::features::drafts_host::DraftsHost::global(cx))
            .children(crate::app::confirm_dialog::ConfirmDialogHost::global(cx))
            .children(crate::ui::image_viewer::MediaViewerHost::global(cx))
            .children(crate::features::ssh_password_dialog::SshPasswordHost::global(cx))
            .children(crate::features::chat::branch_toolbar::BranchToolbarHost::global(cx))
            .children(crate::features::theme_editor::ThemeEditorHost::global(cx))
            .on_modifiers_changed(
                crate::features::sidebar::sidebar_rows_host::SidebarRowsHost::on_modifiers_changed,
            )
            .on_action(
                |action: &crate::features::command_palette::PaletteShortcut, _, cx| {
                    crate::features::command_palette::CommandPaletteHost::shortcut(
                        &action.command,
                        cx,
                    )
                },
            )
            .when_some(settings_client, |this, client| {
                this.on_action(move |_: &crate::platform::OpenSettings, _, cx| {
                    crate::features::settings::open_settings(&client, cx)
                })
            })
    }
}
