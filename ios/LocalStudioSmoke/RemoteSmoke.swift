import Foundation
import XCTest

final class RemoteSmoke: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testPairWatchSendApproveRelaunch() throws {
        let fake = environment["LOCAL_STUDIO_FAKE"] == "1"
        let link = try configuredLink()

        let app = XCUIApplication()
        let channel = fake ? ["-LSPassThrough", "YES"] : []
        app.launchArguments = ["-LSReset", "YES", "-LSSmoke", "YES", "-LSPairLink", link] + channel
        app.launch()
        expectLabel(app, "link-state", "link live", timeout: 30)
        expectLabel(app, "list-source", "list live")

        let row = fake ? element(app, "thread-t1") : app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread-'")).firstMatch
        open(app, row)

        if fake {
            try fakeConversation(app)
            let hellos = try JSONSerialization.jsonObject(with: try hook("hellos", method: "GET")) as? [String: Any]
            XCTAssertEqual(hellos?["hellos"] as? Int, 1, "the app reconnected during the conversation: an update it could not decode, such as needs_answer, dropped the socket")
        } else {
            try realConversation(app)
        }

        app.navigationBars.buttons.element(boundBy: 0).tap()
        if fake {
            try awayApproval(app)
        }
        expectLabel(app, "cache-state", "cache saved", timeout: 10)
        let fresh = timings(app)
        app.terminate()

        app.launchArguments = ["-LSSmoke", "YES", "-LSConnectDelay", "6"] + channel
        app.launch()
        let cachedRow = fake ? element(app, "thread-t1") : app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'thread-'")).firstMatch
        XCTAssertTrue(cachedRow.waitForExistence(timeout: 3), "no cached thread list after relaunch")
        XCTAssertEqual(element(app, "list-source").label, "list cache")
        XCTAssertNotEqual(element(app, "link-state").label, "link live")
        expectLabel(app, "link-state", "link live", timeout: 30)
        expectLabel(app, "list-source", "list live")
        let relaunch = timings(app)

        try record(["server": fake ? "fake-studio" : (URLComponents(string: link)?.queryItems?.first { $0.name == "url" }?.value ?? "real"), "fresh": fresh, "relaunch": relaunch])
    }

    @MainActor
    func testIncompatibleMachine() throws {
        guard let socket = environment["LOCAL_STUDIO_INCOMPATIBLE_URL"], !socket.isEmpty else {
            throw XCTSkip("set LOCAL_STUDIO_INCOMPATIBLE_URL to a fake-studio started with --protocol 4 --min-protocol 3")
        }
        let app = XCUIApplication()
        app.launchArguments = ["-LSReset", "YES", "-LSSmoke", "YES", "-LSPairLink", try pairLink(socket, id: "0000000000000000", secret: String(repeating: "A", count: 43)), "-LSPassThrough", "YES"]
        app.launch()
        expectLabel(app, "link-state", "link incompatible", timeout: 30)
        expectLabel(app, "link-detail", "the machine speaks protocol 3 to 4 and this app 2: update this app")
        app.terminate()
    }

    private func configuredLink() throws -> String {
        if let link = environment["LOCAL_STUDIO_PAIR_LINK"], !link.isEmpty {
            return link
        }
        let hint = "set LOCAL_STUDIO_PAIR_LINK, or LOCAL_STUDIO_REMOTE_URL, LOCAL_STUDIO_PAIR_ID and LOCAL_STUDIO_PAIR_SECRET (with a TEST_RUNNER_ prefix for xcodebuild)"
        return try pairLink(
            try XCTUnwrap(environment["LOCAL_STUDIO_REMOTE_URL"], hint),
            id: try XCTUnwrap(environment["LOCAL_STUDIO_PAIR_ID"], hint),
            secret: try XCTUnwrap(environment["LOCAL_STUDIO_PAIR_SECRET"], hint)
        )
    }

    private func pairLink(_ socket: String, id: String, secret: String) throws -> String {
        var components = URLComponents()
        components.scheme = environment["LOCAL_STUDIO_PAIR_SCHEME"] ?? "localstudio-dev"
        components.host = "pair"
        components.queryItems = [URLQueryItem(name: "url", value: socket), URLQueryItem(name: "name", value: "smoke"), URLQueryItem(name: "id", value: id)]
        components.fragment = secret
        return try XCTUnwrap(components.string)
    }

    @MainActor
    private func open(_ app: XCUIApplication, _ row: XCUIElement) {
        let window = element(app, "transcript-window")
        for _ in 0..<3 {
            XCTAssertTrue(row.waitForExistence(timeout: 10), "no thread row")
            _ = row.wait(for: \.isHittable, toEqual: true, timeout: 5)
            row.tap()
            if window.waitForExistence(timeout: 8) {
                return
            }
        }
        XCTFail("opening the thread showed no transcript")
    }

    @MainActor
    private func fakeConversation(_ app: XCUIApplication) throws {
        send(app, "Smoke ping", button: "send")
        expectText(app, "user: Smoke ping")
        expectText(app, "assistant: Streaming reply to: Smoke ping")
        let approve = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'approve-'")).firstMatch
        XCTAssertTrue(approve.waitForExistence(timeout: 10), "no approval")
        send(app, "Queued follow-up", button: "send-queue")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'queued-'")).firstMatch.waitForExistence(timeout: 10),
            "the queued message never showed"
        )
        approve.tap()
        expectText(app, "tool bash succeeded: echo smoke -> smoke")
        expectText(app, "assistant: Command finished. All done.")
        expectText(app, "user: Queued follow-up")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        XCTAssertTrue(element(app, "last-notification").waitForExistence(timeout: 10), "no notification update")
        open(app, element(app, "thread-t2"))
        expectLabel(app, "transcript-window", "60 earlier · 200 loaded", timeout: 10)
        element(app, "load-earlier").tap()
        expectLabel(app, "transcript-window", "0 earlier · 260 loaded", timeout: 10)
    }

    /// docs/remote.md, Session: while the phone has no socket its buffer takes global updates too, so a
    /// `delta` resume shows an approval raised on a thread it never watched.
    @MainActor
    private func awayApproval(_ app: XCUIApplication) throws {
        _ = try hook("away?thread=t3", method: "POST")
        expectLabel(app, "last-notification", "needs_approval: Settled work", timeout: 30)
        expectLabel(app, "link-state", "link live")
        let resume = try JSONSerialization.jsonObject(with: try hook("last-resume", method: "GET")) as? [String: Any]
        XCTAssertEqual(resume?["resume"] as? String, "delta", "the reconnect after the drop was not a delta resume")
    }

    private func hook(_ path: String, method: String) throws -> Data {
        let socket = try XCTUnwrap(environment["LOCAL_STUDIO_REMOTE_URL"].flatMap(URLComponents.init(string:)))
        let url = try XCTUnwrap(URL(string: "http://\(socket.host ?? "127.0.0.1"):\(socket.port ?? 80)/v1/smoke/\(path)"))
        var request = URLRequest(url: url)
        request.httpMethod = method
        let done = expectation(description: "fake-studio \(path)")
        nonisolated(unsafe) var body: Data?
        URLSession.shared.dataTask(with: request) { data, response, _ in
            if (response as? HTTPURLResponse)?.statusCode == 200 {
                body = data
            }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        return try XCTUnwrap(body, "fake-studio refused \(path)")
    }

    @MainActor
    private func realConversation(_ app: XCUIApplication) throws {
        let prompt = "Reply with the single word pong."
        send(app, prompt, button: "send")
        expectText(app, "user: \(prompt)", timeout: 30)
        let approve = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'approve-'")).firstMatch
        let reply = app.staticTexts.matching(NSPredicate(format: "identifier BEGINSWITH 'item-' AND label BEGINSWITH 'assistant: '")).firstMatch
        let idle = app.staticTexts.matching(NSPredicate(format: "identifier == 'thread-info' AND label BEGINSWITH 'idle'")).firstMatch
        let deadline = Date().addingTimeInterval(180)
        while Date() < deadline {
            if approve.exists {
                approve.tap()
            }
            if reply.exists && idle.exists {
                return
            }
            _ = idle.waitForExistence(timeout: 2)
        }
        XCTFail("the real machine never finished the turn with an assistant reply")
    }

    @MainActor
    private func send(_ app: XCUIApplication, _ text: String, button: String) {
        let composer = element(app, "composer")
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText(text)
        element(app, button).tap()
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @MainActor
    private func expectLabel(_ app: XCUIApplication, _ identifier: String, _ label: String, timeout: TimeInterval = 10) {
        let target = element(app, identifier)
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "\(identifier) missing")
        XCTAssertTrue(target.wait(for: \.label, toEqual: label, timeout: timeout), "\(identifier) is \(target.label), wanted \(label)")
    }

    @MainActor
    private func expectText(_ app: XCUIApplication, _ label: String, timeout: TimeInterval = 15) {
        let target = app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "never saw \(label)")
    }

    @MainActor
    private func timings(_ app: XCUIApplication) -> Any {
        let text = element(app, "perf-timings").label
        return (try? JSONSerialization.jsonObject(with: Data(text.utf8))) ?? text
    }

    private func record(_ result: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
        let text = String(bytes: data, encoding: .utf8) ?? ""
        print("SMOKE_TIMINGS " + text.replacingOccurrences(of: "\n", with: " "))
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "smoke-timings.json"
        attachment.lifetime = .keepAlways
        add(attachment)
        if let path = environment["LOCAL_STUDIO_SMOKE_TIMINGS"] {
            try data.write(to: URL(fileURLWithPath: path))
        }
    }
}
