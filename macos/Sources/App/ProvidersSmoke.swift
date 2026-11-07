import AppKit
import Combine
import Foundation
import LocalStudioKit
import Network

@MainActor
final class ProvidersSmoke {
    private struct Step {
        let name: String
        let act: @MainActor (ProvidersSmoke) -> Void
        let done: @MainActor (ProvidersSmoke) -> Bool
    }

    private static let key = "sk-smoke-endpoint-0001"

    private let store: StudioStore
    private let stub = SmokeEndpoint()
    private var steps: [Step] = []
    private var index = 0
    private var acted = false
    private var subscription: AnyCancellable?
    private var poll: Task<Void, Never>?
    private var discovered: (baseUrl: String, models: [ProviderModel])?
    private var outcomes: [String: RequestOutcome] = [:]
    private var failure: String?

    init(store: StudioStore) {
        self.store = store
        steps = makeSteps()
    }

    func start() {
        stub.start()
        subscription = store.didTick.sink { [weak self] in self?.advance() }
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(250))
                self?.advance()
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
            guard let self, index < steps.count else { return }
            finish(passed: false, "timed out at step \(steps[index].name)")
        }
    }

    private var pages: PagesStore { store.pages }

    private func provider(_ id: String) -> ProviderStatus? {
        pages.providers.first { $0.id == id }
    }

    private func pickerHas(_ provider: String) -> Bool {
        store.conversation.models.contains { $0.provider == provider && $0.configured }
    }

    private func record(_ name: String) -> (RequestOutcome) -> Void {
        { [weak self] outcome in self?.outcomes[name] = outcome }
    }

    private func succeeded(_ name: String) -> Bool {
        guard let outcome = outcomes[name] else { return false }
        if case .failed(let message) = outcome {
            failure = "\(name) failed: \(message)"
        }
        return true
    }

    private func makeSteps() -> [Step] {
        [
            Step(name: "connect", act: { _ in }, done: { $0.store.connection == .ready && $0.stub.port != nil }),
            Step(name: "load providers", act: { $0.pages.loadProviders() }, done: { smoke in
                smoke.pages.providersLoaded && smoke.provider("openai")?.credential == .missing
                    && !smoke.pages.providers.contains { $0.kind == .custom }
            }),
            Step(name: "discover", act: { smoke in
                guard let port = smoke.stub.port else { return }
                smoke.pages.discoverModels(baseUrl: "http://127.0.0.1:\(port)", api: .openAiCompatible, key: Self.key, provider: nil) { outcome in
                    switch outcome {
                    case .models(let baseUrl, let models): smoke.discovered = (baseUrl, models)
                    case .failed(let message): smoke.failure = "discovery failed: \(message)"
                    }
                }
            }, done: { smoke in
                guard let discovered = smoke.discovered, let port = smoke.stub.port else { return false }
                return discovered.baseUrl == "http://127.0.0.1:\(port)/v1" && discovered.models.map(\.id) == ["smoke-1", "smoke-2"]
            }),
            Step(name: "add endpoint", act: { smoke in
                guard let discovered = smoke.discovered else { return }
                let provider = CustomProvider(
                    name: "Smoke Endpoint", baseUrl: discovered.baseUrl, api: .openAiCompatible,
                    key: .set(key: Self.key), models: discovered.models
                )
                smoke.pages.addCustomProvider(provider, finished: smoke.record("add"))
            }, done: { smoke in
                smoke.succeeded("add") && smoke.provider("smoke-endpoint")?.credential == .storedKey
                    && smoke.provider("smoke-endpoint")?.modelCount == 2 && smoke.pickerHas("smoke-endpoint")
            }),
            Step(name: "secrets stay private", act: { _ in }, done: { smoke in
                smoke.checkFiles()
                return true
            }),
            Step(name: "built-in key", act: { $0.pages.setProviderKey("openai", key: "sk-smoke-openai-0002") }, done: { smoke in
                smoke.provider("openai")?.credential == .storedKey && !smoke.pages.isProviderPending("openai")
            }),
            Step(name: "remove built-in key", act: { $0.pages.setProviderKey("openai", key: nil) }, done: { smoke in
                smoke.provider("openai")?.credential == .missing && !smoke.pages.isProviderPending("openai")
            }),
            Step(name: "remove endpoint", act: { $0.pages.removeCustomProvider("smoke-endpoint") }, done: { smoke in
                smoke.provider("smoke-endpoint") == nil && !smoke.pickerHas("smoke-endpoint") && !smoke.pages.isProviderPending("smoke-endpoint")
            }),
        ]
    }

    private func checkFiles() {
        guard let agent = ProcessInfo.processInfo.environment["EUKHE_CODING_AGENT_DIR"] else { return }
        let manager = FileManager.default
        for name in ["models.json", "auth.json"] {
            let path = (agent as NSString).appendingPathComponent(name)
            let mode = (try? manager.attributesOfItem(atPath: path)[.posixPermissions] as? NSNumber)?.intValue
            if mode != 0o600 {
                failure = "\(name) is not 0600"
            }
        }
        let models = (try? String(contentsOfFile: (agent as NSString).appendingPathComponent("models.json"), encoding: .utf8)) ?? ""
        if models.contains(Self.key) {
            failure = "the endpoint key landed in models.json"
        }
    }

    private func advance() {
        while index < steps.count {
            if let failure {
                finish(passed: false, failure)
                return
            }
            let step = steps[index]
            if !acted {
                acted = true
                print("providers smoke: \(step.name)")
                step.act(self)
            }
            guard step.done(self) else { return }
            index += 1
            acted = false
        }
        if let failure {
            finish(passed: false, failure)
            return
        }
        finish(passed: true, "\(steps.count) provider round-trips through Settings → Providers")
    }

    private func finish(passed: Bool, _ detail: String) {
        guard subscription != nil else { return }
        subscription = nil
        poll?.cancel()
        stub.stop()
        print(passed ? "PASS macOS providers smoke: \(detail)" : "FAIL macOS providers smoke: \(detail)")
        if passed {
            NSApp.terminate(nil)
        } else {
            store.stop()
            exit(1)
        }
    }
}

@MainActor
private final class SmokeEndpoint {
    private var listener: NWListener?

    var port: UInt16? {
        guard let listener, listener.state == .ready, let port = listener.port?.rawValue, port != 0 else { return nil }
        return port
    }

    func start() {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        guard let listener = try? NWListener(using: parameters) else { return }
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, _, _ in
                let request = data.flatMap { String(bytes: $0, encoding: .utf8) } ?? ""
                connection.send(content: Data(Self.response(to: request).utf8), completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        listener.start(queue: .global())
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private nonisolated static func response(to request: String) -> String {
        let models = #"{"object":"list","data":[{"id":"smoke-1","object":"model","context_length":32768},{"id":"smoke-2","object":"model"}]}"#
        let found = request.hasPrefix("GET /v1/models ")
        let body = found ? models : #"{"error":{"message":"not found"}}"#
        let status = found ? "200 OK" : "404 Not Found"
        return "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
    }
}
