import Foundation
import Security

public struct MachineCredential: Codable, Sendable, Hashable {
    public var device: String
    public var staticKey: Data
    public var machineKey: Data
    public var machine: String?
    public var urls: [URL]
    public var lastSuccess: [String: Date]

    public init(device: String, staticKey: Data, machineKey: Data, machine: String? = nil, urls: [URL], lastSuccess: [String: Date] = [:]) {
        self.device = device
        self.staticKey = staticKey
        self.machineKey = machineKey
        self.machine = machine
        self.urls = urls
        self.lastSuccess = lastSuccess
    }

    public var orderedURLs: [URL] {
        urls.enumerated()
            .sorted { lhs, rhs in
                let left = lastSuccess[lhs.element.absoluteString] ?? .distantPast
                let right = lastSuccess[rhs.element.absoluteString] ?? .distantPast
                return left == right ? lhs.offset < rhs.offset : left > right
            }
            .map(\.element)
    }

    public mutating func replaceURLs(_ fresh: [String]) {
        let parsed = fresh.compactMap(URL.init(string:)).filter { ["ws", "wss"].contains($0.scheme?.lowercased() ?? "") }
        guard !parsed.isEmpty else {
            return
        }
        urls = parsed
        let kept = Set(parsed.map(\.absoluteString))
        lastSuccess = lastSuccess.filter { kept.contains($0.key) }
    }
}

public struct CredentialStore: Sendable {
    public let service: String

    public init(service: String) {
        self.service = service
    }

    private func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    public func load(_ account: String) -> MachineCredential? {
        var request = query(account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(MachineCredential.self, from: data)
    }

    @discardableResult
    public func save(_ credential: MachineCredential, for account: String) -> Bool {
        guard let data = try? JSONEncoder().encode(credential) else {
            return false
        }
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query(account) as CFDictionary, update as CFDictionary)
        if status == errSecSuccess {
            return true
        }
        var insert = query(account)
        insert.merge(update) { $1 }
        return SecItemAdd(insert as CFDictionary, nil) == errSecSuccess
    }

    public func remove(_ account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }

    public func removeAll() {
        let all: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
        SecItemDelete(all as CFDictionary)
    }
}
