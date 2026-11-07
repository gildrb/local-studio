import Observation
import SwiftUI

@MainActor
@Observable
final class CommandRouter {
    private struct Handler {
        weak var owner: AnyObject?
        let enabled: @MainActor () -> Bool
        let perform: @MainActor () -> Void
    }

    @ObservationIgnored private var handlers: [String: [Handler]] = [:]
    private(set) var revision = 0

    func register(_ command: String, owner: AnyObject, enabled: @escaping @MainActor () -> Bool = { true }, perform: @escaping @MainActor () -> Void) {
        handlers[command, default: []].removeAll { $0.owner == nil || $0.owner === owner }
        handlers[command, default: []].append(Handler(owner: owner, enabled: enabled, perform: perform))
        revision += 1
    }

    func unregister(owner: AnyObject) {
        for key in handlers.keys {
            handlers[key]?.removeAll { $0.owner == nil || $0.owner === owner }
        }
        revision += 1
    }

    func isRegistered(_ command: String) -> Bool {
        handlers[command]?.contains { $0.owner != nil } ?? false
    }

    func canPerform(_ command: String) -> Bool {
        live(command) != nil
    }

    @discardableResult
    func perform(_ command: String) -> Bool {
        guard let handler = live(command) else { return false }
        handler.perform()
        return true
    }

    private func live(_ command: String) -> Handler? {
        handlers[command]?.last { $0.owner != nil && $0.enabled() }
    }
}

final class CommandOwner {}

private struct StudioCommandModifier: ViewModifier {
    let store: StudioStore
    let command: String
    let enabled: Bool
    let perform: @MainActor () -> Void
    @State private var owner = CommandOwner()
    @State private var box = CommandBox()

    func body(content: Content) -> some View {
        box.enabled = enabled
        box.perform = perform
        return content
            .onAppear {
                let box = box
                store.commands.register(command, owner: owner, enabled: { box.enabled }, perform: { box.perform() })
            }
            .onDisappear { store.commands.unregister(owner: owner) }
    }
}

@MainActor
private final class CommandBox {
    var enabled = true
    var perform: @MainActor () -> Void = {}
}

extension View {
    func studioCommand(_ command: String, in store: StudioStore, enabled: Bool = true, perform: @escaping @MainActor () -> Void) -> some View {
        modifier(StudioCommandModifier(store: store, command: command, enabled: enabled, perform: perform))
    }
}

extension StudioStore {
    var commands: CommandRouter { inbox.commands }
}
