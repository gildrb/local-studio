import Foundation

// MARK: - Outbound (client → core)

struct HelloMessage: Encodable {
	let t: String = "hello"
	let server: ServerInfo?
	let t3Home: String
	let platform: String
	let appearance: String

	struct ServerInfo: Encodable {
		let httpUrl: String
		let wsUrl: String
		let bootstrapToken: String
	}
}

struct SubMessage: Encodable {
	let t: String = "sub"
	let id: Int
	let view: String
	let params: JSONValue?
}

struct UnsubMessage: Encodable {
	let t: String = "unsub"
	let id: Int
}

struct ActMessage: Encodable {
	let t: String = "act"
	let id: Int
	let action: String
	let params: JSONValue?
}

// MARK: - Inbound (core → client)

enum InboundMessage: Decodable {
	case ready
	case status(phase: String, detail: String?)
	case view(id: Int, data: JSONValue)
	case result(id: Int, ok: Bool, error: String?)
	case log(level: String, msg: String)
	case term(key: String, op: String, data: String)
	case device(stream: Int, packet: JSONValue)

	private enum CodingKeys: String, CodingKey {
		case t, phase, detail, id, data, ok, error, level, msg, key, op, stream, packet
	}

	init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		let t = try c.decode(String.self, forKey: .t)
		switch t {
		case "ready":
			self = .ready
		case "status":
			self = .status(
				phase: try c.decode(String.self, forKey: .phase),
				detail: try c.decodeIfPresent(String.self, forKey: .detail)
			)
		case "view":
			self = .view(
				id: try c.decode(Int.self, forKey: .id),
				data: try c.decode(JSONValue.self, forKey: .data)
			)
		case "result":
			self = .result(
				id: try c.decode(Int.self, forKey: .id),
				ok: try c.decode(Bool.self, forKey: .ok),
				error: try c.decodeIfPresent(String.self, forKey: .error)
			)
		case "log":
			self = .log(
				level: try c.decode(String.self, forKey: .level),
				msg: try c.decode(String.self, forKey: .msg)
			)
		case "term":
			self = .term(
				key: try c.decode(String.self, forKey: .key),
				op: try c.decode(String.self, forKey: .op),
				data: try c.decode(String.self, forKey: .data)
			)
		case "device":
			self = .device(
				stream: try c.decode(Int.self, forKey: .stream),
				packet: try c.decode(JSONValue.self, forKey: .packet)
			)
		default:
			throw DecodingError.dataCorruptedError(
				forKey: .t, in: c,
				debugDescription: "Unknown inbound type: \(t)"
			)
		}
	}
}

// MARK: - JSONValue (generic JSON container)

indirect enum JSONValue: Decodable, Encodable, Equatable {
	case null
	case bool(Bool)
	case int(Int)
	case double(Double)
	case string(String)
	case array([JSONValue])
	case object([String: JSONValue])

	init(from decoder: Decoder) throws {
		let c = try decoder.singleValueContainer()
		if c.decodeNil() {
			self = .null
		} else if let b = try? c.decode(Bool.self) {
			self = .bool(b)
		} else if let i = try? c.decode(Int.self) {
			self = .int(i)
		} else if let d = try? c.decode(Double.self) {
			self = .double(d)
		} else if let s = try? c.decode(String.self) {
			self = .string(s)
		} else if let a = try? c.decode([JSONValue].self) {
			self = .array(a)
		} else if let o = try? c.decode([String: JSONValue].self) {
			self = .object(o)
		} else {
			throw DecodingError.dataCorruptedError(
				in: c, debugDescription: "Unsupported JSON value"
			)
		}
	}

	func encode(to encoder: Encoder) throws {
		var c = encoder.singleValueContainer()
		switch self {
		case .null: try c.encodeNil()
		case .bool(let v): try c.encode(v)
		case .int(let v): try c.encode(v)
		case .double(let v): try c.encode(v)
		case .string(let v): try c.encode(v)
		case .array(let v): try c.encode(v)
		case .object(let v): try c.encode(v)
		}
	}

	var stringValue: String? {
		if case .string(let s) = self { return s }
		return nil
	}

	var intValue: Int? {
		if case .int(let i) = self { return i }
		if case .double(let d) = self { return Int(d) }
		return nil
	}

	var boolValue: Bool? {
		if case .bool(let b) = self { return b }
		return nil
	}

	var arrayValue: [JSONValue]? {
		if case .array(let a) = self { return a }
		return nil
	}

	var objectValue: [String: JSONValue]? {
		if case .object(let o) = self { return o }
		return nil
	}

	subscript(key: String) -> JSONValue? {
		guard case .object(let o) = self else { return nil }
		return o[key]
	}

	func decode<T: Decodable>(as type: T.Type) -> T? {
		let data = try? JSONEncoder().encode(self)
		guard let data else { return nil }
		return try? JSONDecoder().decode(T.self, from: data)
	}
}

extension JSONValue: CustomStringConvertible {
	var description: String {
		let data = try? JSONEncoder().encode(self)
		guard let data, let s = String(data: data, encoding: .utf8) else { return "null" }
		return s
	}
}
