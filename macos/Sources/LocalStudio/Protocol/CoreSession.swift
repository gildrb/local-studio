import Foundation
import Combine
import SwiftUI

// Owns the backend lifecycle and the core client, and republishes the
// subscribed view models on the main thread for SwiftUI.
@MainActor
final class CoreSession: ObservableObject {
	enum Phase: Equatable {
		case starting
		case failed(String)
		case connected
	}

	@Published private(set) var phase: Phase = .starting
	@Published private(set) var shell: AppShellView?
	@Published private(set) var sidebar: SidebarView?
	@Published private(set) var timeline: TimelineView?
	@Published private(set) var composer: ComposerView?
	@Published private(set) var toasts: ToastsView?
	@Published private(set) var modelPicker: ModelPickerView?
	@Published private(set) var headerToolbar: HeaderToolbarView?
	@Published private(set) var appTheme: AppThemeView?

	private var client: CoreClient?
	private var cancellables = Set<AnyCancellable>()

	func start() {
		phase = .starting
		let appearance = appearanceName()
		Thread { [weak self] in
			guard let self else { return }
			do {
				let runtime = try Backend.runtime()
				let home = Backend.t3Home()
				let settings = desktopLaunchSettings(home: home)
				let server = settings.localEnvironmentEnabled
					? try Backend.startServer(runtime: runtime, home: home, settings: settings)
					: nil
				let core = try Backend.startCore(runtime: runtime)
				let hello = HelloMessage(
					server: server.map {
						HelloMessage.ServerInfo(
							httpUrl: $0.httpUrl,
							wsUrl: $0.wsUrl,
							bootstrapToken: $0.bootstrapToken
						)
					},
					t3Home: home.path,
					platform: "darwin",
					appearance: appearance
				)
				let client = CoreClient.start(process: core, hello: hello)
				DispatchQueue.main.async {
					self.attach(client: client)
				}
			} catch {
				let message = error.localizedDescription
				DispatchQueue.main.async {
					self.fail(message)
				}
			}
		}.start()
	}

	private func attach(client: CoreClient) {
		self.client = client
		client.$ready
			.receive(on: DispatchQueue.main)
			.sink { [weak self] ready in
				guard let self, ready else { return }
				self.phase = .connected
			}
			.store(in: &cancellables)

		client.$status
			.receive(on: DispatchQueue.main)
			.sink { [weak self] status in
				guard let self, let status else { return }
				if status.phase == "failed" {
					self.phase = .failed(status.detail ?? "connection failed")
				}
			}
			.store(in: &cancellables)

		client.subscribe(view: "app-shell") { [weak self] (v: AppShellView) in
			self?.shell = v
		}
		client.subscribe(view: "sidebar") { [weak self] (v: SidebarView) in
			self?.sidebar = v
		}
		client.subscribe(view: "timeline") { [weak self] (v: TimelineView) in
			self?.timeline = v
		}
		client.subscribe(view: "composer") { [weak self] (v: ComposerView) in
			self?.composer = v
		}
		client.subscribe(view: "toasts") { [weak self] (v: ToastsView) in
			self?.toasts = v
		}
		client.subscribe(view: "modelPicker") { [weak self] (v: ModelPickerView) in
			self?.modelPicker = v
		}
		client.subscribe(view: "headerToolbar") { [weak self] (v: HeaderToolbarView) in
			self?.headerToolbar = v
		}
		client.subscribe(view: "appTheme") { [weak self] (v: AppThemeView) in
			self?.appTheme = v
		}

		client.act("appSetSystemAppearance", params: .object([
			"appearance": .string(appearanceName())
		]))
	}

	private func fail(_ message: String) {
		phase = .failed(message)
	}

	private func appearanceName() -> String {
		NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? "dark" : "light"
	}

	// MARK: - Actions

	func selectThread(environmentId: String, threadId: String) {
		client?.act("selectThread", params: .object([
			"environmentId": .string(environmentId),
			"threadId": .string(threadId)
		]))
	}

	func setPrompt(_ prompt: String) {
		client?.act("setPrompt", params: .object(["prompt": .string(prompt)]))
	}

	func send() {
		client?.act("send", params: .object([:]))
	}

	func interrupt() {
		client?.act("interrupt", params: .object([:]))
	}

	func openModelPicker() {
		client?.act("openModelPicker", params: .object([:]))
	}

	func closeModelPicker() {
		client?.act("closeModelPicker", params: .object([:]))
	}

	func modelPickerSearch(_ query: String) {
		client?.act("modelPickerSearch", params: .object(["query": .string(query)]))
	}

	func modelPickerSelect(instanceId: String, slug: String) {
		client?.act("modelPickerSelect", params: .object([
			"instanceId": .string(instanceId),
			"slug": .string(slug)
		]))
	}

	func toggleTurnFold(_ turnId: String) {
		client?.act("toggleTurnFold", params: .object(["turnId": .string(turnId)]))
	}

	func toggleWorkGroup(_ groupId: String) {
		client?.act("toggleWorkGroup", params: .object(["groupId": .string(groupId)]))
	}

	func dismissToast(_ id: String) {
		client?.act("dismissToast", params: .object(["id": .string(id)]))
	}

	func toastAction(_ id: String, key: String) {
		client?.act("toastAction", params: .object([
			"id": .string(id),
			"key": .string(key)
		]))
	}

	func navigate(_ page: String) {
		client?.act("navigate", params: .object(["page": .object(["kind": .string(page)])]))
	}

	func unavailable(_ feature: String) {
		client?.act("unavailable", params: .object(["feature": .string(feature)]))
	}

	func shutdown() {
		Backend.stopAll()
	}
}
