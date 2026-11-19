import Foundation

public struct PairingLink: Sendable, Hashable {
    public static let schemes: Set<String> = ["localstudio", "localstudio-nightly", "localstudio-dev"]
    public static let secretLength = 32

    public var scheme: String
    public var url: URL
    public var name: String
    public var id: String
    public var secret: Data

    public init(scheme: String = "localstudio", url: URL, name: String, id: String, secret: Data) {
        self.scheme = scheme
        self.url = url
        self.name = name
        self.id = id
        self.secret = secret
    }

    /// A link scanned or pasted into the app with the scheme `scheme`; any other channel's scheme
    /// is refused, so each channel's app pairs only with its own desktop channel.
    public init?(string: String, scheme expected: String) {
        guard let link = PairingLink(string: string), link.scheme == expected.lowercased() else {
            return nil
        }
        self = link
    }

    public init?(string: String) {
        guard let link = URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        self.init(url: link)
    }

    public init?(url link: URL) {
        guard
            let components = URLComponents(url: link, resolvingAgainstBaseURL: false),
            let scheme = components.scheme?.lowercased(),
            Self.schemes.contains(scheme),
            (components.host ?? components.path).lowercased() == "pair",
            let fragment = components.fragment,
            let secret = Data(base64URL: fragment), secret.count == Self.secretLength,
            let id = components.queryItems?.first(where: { $0.name == "id" })?.value, !id.isEmpty,
            let target = components.queryItems?.first(where: { $0.name == "url" })?.value,
            let url = URL(string: target),
            let socketScheme = url.scheme?.lowercased(),
            ["ws", "wss"].contains(socketScheme),
            url.host != nil
        else {
            return nil
        }
        let name = components.queryItems?.first(where: { $0.name == "name" })?.value
        self.scheme = scheme
        self.url = url
        self.name = name.flatMap { $0.isEmpty ? nil : $0 } ?? url.host ?? "machine"
        self.id = id
        self.secret = secret
    }

    public var string: String {
        var components = URLComponents()
        components.scheme = scheme
        components.host = "pair"
        components.queryItems = [
            URLQueryItem(name: "url", value: url.absoluteString),
            URLQueryItem(name: "name", value: name),
            URLQueryItem(name: "id", value: id),
        ]
        components.percentEncodedQuery = components.percentEncodedQuery?
            .replacingOccurrences(of: ":", with: "%3A")
            .replacingOccurrences(of: "/", with: "%2F")
        components.fragment = secret.base64URL
        return components.string ?? ""
    }
}

extension Data {
    public init?(base64URL text: String) {
        var standard = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while standard.count % 4 != 0 {
            standard += "="
        }
        self.init(base64Encoded: standard)
    }

    public var base64URL: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
