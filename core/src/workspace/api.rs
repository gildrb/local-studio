use super::model::{
    CustomProvider, DiffScope, LocalAction, MergeMethod, ProjectScript, ProjectSettings, ProviderApi, Settings,
    TerminalFrame, TerminalKey, TerminalMouse, TerminalScroll, TerminalSelect, TerminalSize, UsagePeriod,
};
use super::terminal::{self, Message};
use crate::studio::Studio;

#[cfg_attr(feature = "ffi", uniffi::export)]
#[allow(clippy::needless_pass_by_value)]
#[must_use]
pub fn terminal_preview(cols: u16, rows: u16, data: Vec<u8>) -> Option<TerminalFrame> {
    terminal::preview(cols, rows, &data)
}

#[cfg_attr(feature = "ffi", uniffi::export)]
impl Studio {
    pub fn git_status(&self, project: String) {
        self.workspace.git_status(project);
    }

    pub fn list_branches(&self, request: String, project: String, query: String, limit: u32) {
        self.workspace.list_branches(request, project, query, limit);
    }

    pub fn create_worktree(&self, request: String, project: String, branch: String, base: Option<String>) {
        self.workspace.create_worktree(request, project, branch, base);
    }

    pub fn load_diff(&self, request: String, project: String, scope: DiffScope) {
        self.workspace.load_diff(request, project, scope);
    }

    pub fn commit(&self, request: String, project: String, message: Option<String>) {
        self.workspace.commit(request, project, message);
    }

    pub fn push(&self, request: String, project: String) {
        self.workspace.push_branch(request, project);
    }

    pub fn create_pull_request(&self, request: String, project: String, title: String, body: String, draft: bool) {
        self.workspace.create_pull_request(request, project, title, body, draft);
    }

    pub fn list_pull_requests(&self, request: String, project: String) {
        self.workspace.list_pull_requests(request, project);
    }

    pub fn load_pull_request(&self, request: String, project: String, number: u64) {
        self.workspace.load_pull_request(request, project, number);
    }

    pub fn pull(&self, request: String, project: String) {
        self.workspace.pull(request, project);
    }

    pub fn publish_repository(&self, request: String, project: String, name: String, private: bool) {
        self.workspace.publish_repository(request, project, name, private);
    }

    pub fn list_devices(&self, request: String) {
        self.workspace.list_devices(request);
    }

    pub fn boot_device(&self, request: String, device: String) {
        self.workspace.boot_device(request, device);
    }

    pub fn shutdown_device(&self, request: String, device: String) {
        self.workspace.shutdown_device(request, device);
    }

    pub fn list_directory(&self, request: String, project: String, relative: String) {
        self.workspace.list_directory(request, project, relative);
    }

    pub fn read_file(&self, request: String, project: String, relative: String) {
        self.workspace.read_file(request, project, relative);
    }

    pub fn search_files(&self, request: String, project: String, query: String, limit: u32) {
        self.workspace.search_files(request, project, query, limit);
    }

    pub fn search_text(&self, request: String, project: String, query: String, limit: u32) {
        self.workspace.search_text(request, project, query, limit);
    }

    pub fn open_terminal(&self, request: String, project: String, cols: u16, rows: u16) {
        self.workspace.open_terminal(request, project, cols, rows);
    }

    pub fn write_terminal(&self, terminal: String, data: Vec<u8>) {
        self.workspace.write_terminal(terminal, data);
    }

    pub fn resize_terminal(&self, terminal: String, size: TerminalSize) {
        self.workspace.resize_terminal(terminal, size);
    }

    pub fn terminal_key(&self, terminal: String, key: TerminalKey) {
        self.workspace.terminal(terminal, Message::Key(key));
    }

    pub fn terminal_paste(&self, terminal: String, text: String) {
        self.workspace.terminal(terminal, Message::Paste(text));
    }

    pub fn terminal_mouse(&self, terminal: String, mouse: TerminalMouse) {
        self.workspace.terminal(terminal, Message::Mouse(mouse));
    }

    pub fn terminal_scroll(&self, terminal: String, scroll: TerminalScroll) {
        self.workspace.terminal(terminal, Message::Scroll(scroll));
    }

    pub fn terminal_focus(&self, terminal: String, focused: bool) {
        self.workspace.terminal(terminal, Message::Focus(focused));
    }

    pub fn terminal_select(&self, terminal: String, selection: TerminalSelect) {
        self.workspace.terminal(terminal, Message::Select(selection));
    }

    pub fn terminal_selection_text(&self, request: String, terminal: String) {
        let reply = request.clone();
        self.workspace.terminal_request(request, terminal, Message::SelectionText(reply));
    }

    pub fn terminal_recent_output(&self, request: String, terminal: String, lines: u32) {
        let reply = request.clone();
        self.workspace.terminal_request(request, terminal, Message::RecentOutput(reply, lines));
    }

    pub fn close_terminal(&self, terminal: String) {
        self.workspace.close_terminal(terminal);
    }

    pub fn load_usage(&self, request: String, period: UsagePeriod) {
        self.workspace.load_usage(request, period);
    }

    pub fn local_snapshot(&self, request: String) {
        self.workspace.local_snapshot(request);
    }

    pub fn local_action(&self, request: String, action: LocalAction) {
        self.workspace.local_action(request, action);
    }

    pub fn load_providers(&self) {
        self.workspace.load_providers();
        self.load_models();
    }

    pub fn discover_provider_models(
        &self,
        request: String,
        base_url: String,
        api: ProviderApi,
        key: Option<String>,
        provider: Option<String>,
    ) {
        self.workspace.discover_provider_models(request, base_url, api, key, provider);
    }

    pub fn add_custom_provider(&self, request: String, provider: CustomProvider) {
        self.workspace.add_custom_provider(request, provider);
    }

    pub fn update_custom_provider(&self, request: String, id: String, provider: CustomProvider) {
        self.workspace.update_custom_provider(request, id, provider);
    }

    pub fn remove_custom_provider(&self, request: String, id: String) {
        self.workspace.remove_custom_provider(request, id);
    }

    pub fn refresh_provider_models(&self, request: String, id: String) {
        self.workspace.refresh_provider_models(request, id);
    }

    pub fn set_provider_key(&self, request: String, provider: String, key: Option<String>) {
        self.workspace.set_provider_key(request, provider, key);
    }

    pub fn use_local_engine(&self, request: String, engine: String) {
        self.workspace.use_local_engine(request, engine);
    }

    pub fn update_settings(&self, settings: Settings) {
        self.workspace.update_settings(settings);
    }

    pub fn set_keybinding(&self, command: String, shortcut: Option<String>) {
        self.workspace.set_keybinding(command, shortcut);
    }

    pub fn load_project_settings(&self, project: String) {
        self.workspace.load_project_settings(project);
    }

    pub fn set_project_scripts(&self, project: String, scripts: Vec<ProjectScript>) {
        self.workspace.set_project_scripts(project, scripts);
    }

    pub fn import_project_scripts(&self, request: String, project: String) {
        self.workspace.import_project_scripts(request, project);
    }

    pub fn run_project_script(&self, request: String, project: String, script: String) {
        self.workspace.run_project_script(request, project, script);
    }

    pub fn update_project_settings(&self, project: String, settings: ProjectSettings) {
        self.workspace.update_project_settings(project, settings);
    }

    pub fn cancel_worktree_setup(&self, thread: String) {
        self.workspace.cancel_worktree_setup(thread);
    }

    pub fn skip_worktree_setup(&self, thread: String) {
        self.workspace.skip_worktree_setup(thread);
    }

    pub fn checkout_pull_request(&self, request: String, project: String, number: u64) {
        self.workspace.checkout_pull_request(request, project, number);
    }

    pub fn clone_project(&self, request: String, url: String, parent_dir: String) {
        self.workspace.clone_project(request, url, parent_dir);
    }

    pub fn merge_pull_request(&self, request: String, project: String, number: u64, method: Option<MergeMethod>) {
        self.workspace.merge_pull_request(request, project, number, method);
    }

    pub fn cleanup_worktrees(&self, request: String) {
        self.workspace.cleanup_worktrees(request);
    }
}
