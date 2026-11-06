import Foundation
import Combine

// A view subscription: holds the latest decoded value and notifies observers.
final class ViewState<Value: Decodable & Equatable>: ObservableObject {
	@Published var data: Value?
	let id: Int

	init(id: Int) {
		self.id = id
	}
}

final class CoreClient: ObservableObject {
	@Published private(set) var ready = false
	@Published private(set) var status: CoreStatus?

	var onResult: ((Int, Bool, String?) -> Void)?

	private var outbox: FileHandle
	private var nextID: Int = 1
	private var views: [Int: (JSONValue) -> Void] = [:]
	private let queue = DispatchQueue(label: "local-studio.core-client")

	struct CoreStatus: Equatable {
		let phase: String
		let detail: String?
	}

	static func start(process: CoreProcess, hello: HelloMessage) -> CoreClient {
		let client = CoreClient(process: process)
		client.send(hello)
		client.startReader(stdout: process.stdout)
		return client
	}

	private init(process: CoreProcess) {
		self.outbox = process.stdin
	}

	private func startReader(stdout: FileHandle) {
		let (inbox, inboxContinuation) = AsyncStream.makeStream(of: InboundMessage.self)
		let thread = Thread {
			var buffer = Data()
			while true {
				let chunk = stdout.availableData
				if chunk.isEmpty { break }
				buffer.append(chunk)
				while let newline = buffer.firstIndex(of: 0x0a) {
					let lineData = buffer.subdata(in: buffer.startIndex..<newline)
					buffer.removeSubrange(buffer.startIndex...newline)
					let trimmed = String(data: lineData, encoding: .utf8)?
						.trimmingCharacters(in: .whitespaces) ?? ""
					if trimmed.isEmpty { continue }
					if let msg = try? JSONDecoder().decode(InboundMessage.self, from: Data(trimmed.utf8)) {
						inboxContinuation.yield(msg)
					}
				}
			}
			inboxContinuation.finish()
		}
		thread.start()

		queue.async {
			Task {
				for await message in inbox {
					self.receive(message)
				}
			}
		}
	}

	private func receive(_ message: InboundMessage) {
		switch message {
		case .ready:
			DispatchQueue.main.async { self.ready = true }
		case .status(let phase, let detail):
			DispatchQueue.main.async { self.status = CoreStatus(phase: phase, detail: detail) }
		case .view(let id, let data):
			queue.async {
				self.views[id]?(data)
			}
		case .result(let id, let ok, let error):
			DispatchQueue.main.async {
				self.onResult?(id, ok, error)
			}
			if !ok {
				FileHandle.standardError.write("core: action \(id) failed: \(error ?? "unknown")\n".data(using: .utf8)!)
			}
		case .log(let level, let msg):
			FileHandle.standardError.write("core \(level): \(msg)\n".data(using: .utf8)!)
		case .term, .device:
			break
		}
	}

	private func send(_ message: Encodable) {
		queue.async {
			guard var data = try? JSONEncoder().encode(message) else { return }
			data.append(0x0a)
			self.outbox.write(data)
		}
	}

	private func allocate() -> Int {
		queue.sync {
			let id = nextID
			nextID += 1
			return id
		}
	}

	func subscribe<Value: Decodable & Equatable>(
		view: String,
		params: JSONValue? = nil,
		_ transform: @escaping (Value) -> Void
	) -> ViewState<Value> {
		let id = allocate()
		let state = ViewState<Value>(id: id)
		queue.async {
			self.views[id] = { data in
				guard let value = data.decode(as: Value.self) else { return }
				DispatchQueue.main.async {
					state.data = value
					transform(value)
				}
			}
			self.send(SubMessage(id: id, view: view, params: params))
		}
		return state
	}

	func act(_ action: String, params: JSONValue? = nil) {
		let id = allocate()
		send(ActMessage(id: id, action: action, params: params))
	}
}
