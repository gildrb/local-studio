import Foundation

public protocol WireEnum: RawRepresentable, CaseIterable, Codable, Sendable, Hashable where RawValue == String {}

enum WireName {
    static func fold(_ name: String) -> String {
        name.lowercased().filter { $0 != "_" && $0 != "-" }
    }
}

struct TypeKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }

    init(stringValue: String) {
        self.stringValue = stringValue
    }

    init?(intValue: Int) {
        nil
    }

    static let type = TypeKey(stringValue: "type")
}

extension WireEnum {
    public init(from decoder: any Decoder) throws {
        let raw: String
        if let single = try? decoder.singleValueContainer(), let text = try? single.decode(String.self) {
            raw = text
        } else {
            let keyed = try decoder.container(keyedBy: TypeKey.self)
            raw = try keyed.decode(String.self, forKey: .type)
        }
        let folded = WireName.fold(raw)
        guard let match = Self.allCases.first(where: { WireName.fold($0.rawValue) == folded }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown \(Self.self) \(raw)"))
        }
        self = match
    }

    public func encode(to encoder: any Encoder) throws {
        var single = encoder.singleValueContainer()
        try single.encode(rawValue)
    }
}

extension KeyedDecodingContainer where K == TypeKey {
    func value<T: Decodable>(_ key: String, as type: T.Type = T.self) throws -> T {
        try decode(T.self, forKey: TypeKey(stringValue: key))
    }

    func optional<T: Decodable>(_ key: String, as type: T.Type = T.self) throws -> T? {
        try decodeIfPresent(T.self, forKey: TypeKey(stringValue: key))
    }

    func list<T: Decodable>(_ key: String, as type: T.Type = T.self) throws -> [T] {
        try decodeIfPresent([T].self, forKey: TypeKey(stringValue: key)) ?? []
    }

    func tag() throws -> String {
        try decode(String.self, forKey: .type)
    }
}

extension KeyedEncodingContainer where K == TypeKey {
    mutating func put<T: Encodable>(_ value: T, _ key: String) throws {
        try encode(value, forKey: TypeKey(stringValue: key))
    }

    mutating func tag(_ name: String) throws {
        try encode(name, forKey: .type)
    }
}
