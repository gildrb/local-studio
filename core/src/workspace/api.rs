use super::model::{DiffScope, LocalAction, Settings, UsagePeriod};
use crate::studio::Studio;

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

    pub fn resize_terminal(&self, terminal: String, cols: u16, rows: u16) {
        self.workspace.resize_terminal(terminal, cols, rows);
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
        self.workspace.push_cached_providers();
        self.load_models();
    }

    pub fn update_settings(&self, settings: Settings) {
        self.workspace.update_settings(settings);
    }

    pub fn set_keybinding(&self, command: String, shortcut: Option<String>) {
        self.workspace.set_keybinding(command, shortcut);
    }
}
