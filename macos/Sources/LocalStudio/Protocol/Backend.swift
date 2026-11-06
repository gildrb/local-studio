import Foundation

// MARK: - Runtime resolution

struct Runtime {
	let root: URL
	let serverEntry: URL
	let coreEntry: URL
	let node: URL
	let bundle: URL?
}

struct ServerInfo {
	let httpUrl: String
	let wsUrl: String
	let bootstrapToken: String
}

struct CoreProcess {
	let stdin: FileHandle
	let stdout: FileHandle
}

enum BackendError: LocalizedError {
	case message(String)
	var errorDescription: String? {
		switch self {
		case .message(let m): return m
		}
	}
}

private let defaultPort: UInt16 = 3773
private let readinessPath = "/.well-known/t3/environment"
private let readinessInterval: TimeInterval = 0.1
private let readinessTimeout: TimeInterval = 60
private let stopGrace: TimeInterval = 5
private let sourceServerEntry = "apps/server/src/bin.ts"
private let sourceCoreEntry = "packages/app-core/src/main.ts"
private let bundledServerEntry = "apps/server/dist/bin.mjs"
private let bundledCoreEntry = "packages/app-core/src/main.mjs"
private let appBundleEnv = "LOCAL_STUDIO_APP_BUNDLE"
private let clearedEnv: [String] = [
	"T3CODE_PORT", "T3CODE_MODE", "T3CODE_NO_BROWSER", "T3CODE_HOST",
	"T3CODE_DESKTOP_WS_URL", "T3CODE_DESKTOP_LAN_ACCESS", "T3CODE_DESKTOP_LAN_HOST",
	"T3CODE_DESKTOP_HTTPS_ENDPOINTS", "T3CODE_TAILSCALE_SERVE", "T3CODE_TAILSCALE_SERVE_PORT",
]

final class Backend {
	private static var children: [pid_t] = []
	private static let childrenLock = NSLock()
	private static var lastExitStatus: Int32 = 0

	static func t3Home() -> URL {
		if let env = ProcessInfo.processInfo.environment["LOCAL_STUDIO_T3_HOME"], !env.isEmpty {
			return URL(fileURLWithPath: env)
		}
		let home = FileManager.default.homeDirectoryForCurrentUser
		return home.appendingPathComponent(".local-studio-t3")
	}

	static func runtime() throws -> Runtime {
		let exe = URL(fileURLWithPath: CommandLine.arguments[0])
		if let bundled = bundledRuntime(exe: exe) {
			return bundled
		}
		return try sourceRuntime()
	}

	private static func bundledRuntime(exe: URL) -> Runtime? {
		// Contents/MacOS/<exe> → Contents → <Bundle>.app
		let contents = exe.deletingLastPathComponent()
		let bundle = contents.deletingLastPathComponent()
		let root = contents.appendingPathComponent("Resources/app")
		let serverEntry = root.appendingPathComponent(bundledServerEntry)
		let coreEntry = root.appendingPathComponent(bundledCoreEntry)
		guard bundle.pathExtension == "app",
			  FileManager.default.fileExists(atPath: serverEntry.path),
			  FileManager.default.fileExists(atPath: coreEntry.path)
		else { return nil }
		let node = ProcessInfo.processInfo.environment["LOCAL_STUDIO_NODE"]
			.map { URL(fileURLWithPath: $0) }
			?? contents.appendingPathComponent("MacOS/node")
		return Runtime(root: root, serverEntry: serverEntry, coreEntry: coreEntry, node: node, bundle: bundle)
	}

	private static func sourceRuntime() throws -> Runtime {
		let starts: [URL] = [
			URL(fileURLWithPath: CommandLine.arguments[0]),
			URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
		]
		var root: URL?
		for start in starts {
			var dir = start
			while dir.path != "/" {
				let candidate = dir.appendingPathComponent(sourceServerEntry)
				if FileManager.default.fileExists(atPath: candidate.path) {
					root = dir
					break
				}
				dir = dir.deletingLastPathComponent()
			}
			if root != nil { break }
		}
		guard let root else {
			throw BackendError.message("cannot find \(sourceServerEntry) above the binary or working directory")
		}
		let node = resolveNode()
		return Runtime(
			root: root,
			serverEntry: root.appendingPathComponent(sourceServerEntry),
			coreEntry: root.appendingPathComponent(sourceCoreEntry),
			node: node,
			bundle: nil
		)
	}

	private static func resolveNode() -> URL {
		if let override = ProcessInfo.processInfo.environment["LOCAL_STUDIO_NODE"] {
			return URL(fileURLWithPath: override)
		}
		let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
		for dir in path.split(separator: ":") {
			let candidate = URL(fileURLWithPath: String(dir)).appendingPathComponent("node")
			if FileManager.default.isExecutableFile(atPath: candidate.path) {
				return candidate
			}
		}
		return URL(fileURLWithPath: "/usr/bin/env").appendingPathComponent("node")
	}

	// MARK: - Server

	static func startServer(runtime: Runtime, home: URL, settings: LaunchSettings) throws -> ServerInfo {
		try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
		let token = try bootstrapToken()
		let port = try freePort()
		let host = bindHost(settings: settings)
		let payload = try makeBootstrapPayload(
			port: port, home: home, host: host, token: token, settings: settings
		)
		let logPath = home.appendingPathComponent("logs/gpui-server.log")
		try FileManager.default.createDirectory(
			at: home.appendingPathComponent("logs"), withIntermediateDirectories: true
		)
		let logFD = open(logPath.path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
		guard logFD >= 0 else {
			throw BackendError.message("cannot open server log: \(String(cString: strerror(errno)))")
		}
		let nullFD = open("/dev/null", O_RDWR)
		guard nullFD >= 0 else {
			throw BackendError.message("cannot open /dev/null: \(String(cString: strerror(errno)))")
		}

		var env = ProcessInfo.processInfo.environment
		for name in clearedEnv {
			env.removeValue(forKey: name)
		}

		var pipeFDs = [Int32](repeating: 0, count: 2)
		guard pipe(&pipeFDs) == 0 else {
			throw BackendError.message("cannot create bootstrap pipe: \(String(cString: strerror(errno)))")
		}

		// Move every source fd to a fixed high fd (100+) so none collides with
		// the child's 0/1/2/3 targets. dup2 to a fixed number is safe here: in
		// a fresh process those high fds are free.
		func toHigh(_ fd: Int32, _ target: Int32) -> Int32 {
			let high = dup2(fd, target)
			close(fd)
			return high
		}
		let readFD = toHigh(pipeFDs[0], 100)
		let writeFD = toHigh(pipeFDs[1], 101)
		let logFDHigh = toHigh(logFD, 102)
		let nullFDHigh = toHigh(nullFD, 103)
		guard readFD == 100, writeFD == 101, logFDHigh == 102, nullFDHigh == 103 else {
			throw BackendError.message("cannot move server fds: \(String(cString: strerror(errno)))")
		}

		let argv = [runtime.node.path, runtime.serverEntry.path, "--bootstrap-fd", "3"]
		let envArray = env.map { "\($0.key)=\($0.value)" }

		var fileActions: posix_spawn_file_actions_t? = posix_spawn_file_actions_t.allocate(byteCount: 1, alignment: 1)
		posix_spawn_file_actions_init(&fileActions)
		posix_spawn_file_actions_adddup2(&fileActions, readFD, 3)
		posix_spawn_file_actions_adddup2(&fileActions, nullFDHigh, 0)
		posix_spawn_file_actions_adddup2(&fileActions, logFDHigh, 1)
		posix_spawn_file_actions_adddup2(&fileActions, logFDHigh, 2)
		if readFD != 3 {
			posix_spawn_file_actions_addclose(&fileActions, readFD)
		}
		if writeFD != 3 {
			posix_spawn_file_actions_addclose(&fileActions, writeFD)
		}
		posix_spawn_file_actions_addclose(&fileActions, nullFDHigh)
		posix_spawn_file_actions_addclose(&fileActions, logFDHigh)

		var cArgv: [UnsafeMutablePointer<CChar>?] = argv.map { strdup($0) }
		cArgv.append(nil)
		var cEnv: [UnsafeMutablePointer<CChar>?] = envArray.map { strdup($0) }
		cEnv.append(nil)

		// The server resolves its entry point relative to cwd; the GUI app has
		// no cwd dependency, so chdir the parent before spawning.
		chdir(runtime.root.path)

		var pid: pid_t = 0
		let status = cArgv.withUnsafeBufferPointer { argvBuf in
			cEnv.withUnsafeBufferPointer { envBuf in
				posix_spawn(
					&pid,
					runtime.node.path,
					&fileActions,
					nil,
					argvBuf.baseAddress!,
					envBuf.baseAddress!
				)
			}
		}
		posix_spawn_file_actions_destroy(&fileActions)
		fileActions?.deallocate()
		for p in cArgv { if let p { free(p) } }
		for p in cEnv { if let p { free(p) } }

		guard status == 0 else {
			throw BackendError.message("cannot start server: \(String(cString: strerror(status)))")
		}

		// Parent: drop the read end (only the child needs it), write the
		// bootstrap envelope, then close the write end so the child sees EOF.
		close(readFD)
		let writer = FileHandle(fileDescriptor: writeFD)
		writer.write(payload)
		close(writeFD)

		track(pid)

		let started = Date()
		while true {
			if exited(pid: pid) {
				let status = Backend.lastExitStatus
				let logContent = (try? String(contentsOf: logPath, encoding: .utf8)) ?? ""
				throw BackendError.message(
					"server exited before it was ready (status=\(status)); log: \(logContent.prefix(800))"
				)
			}
			if ready(port: port) { break }
			if Date().timeIntervalSince(started) > readinessTimeout {
				throw BackendError.message("server did not become ready on port \(port)")
			}
			Thread.sleep(forTimeInterval: readinessInterval)
		}
		return ServerInfo(
			httpUrl: "http://127.0.0.1:\(port)",
			wsUrl: "ws://127.0.0.1:\(port)",
			bootstrapToken: token
		)
	}

	private static func makeBootstrapPayload(
		port: UInt16, home: URL, host: String, token: String, settings: LaunchSettings
	) throws -> Data {
		struct Bootstrap: Encodable {
			let mode: String
			let noBrowser: Bool
			let port: Int
			let t3Home: String
			let host: String
			let desktopBootstrapToken: String
			let tailscaleServeEnabled: Bool
			let tailscaleServePort: Int
		}
		let b = Bootstrap(
			mode: "desktop",
			noBrowser: true,
			port: Int(port),
			t3Home: home.path,
			host: host,
			desktopBootstrapToken: token,
			tailscaleServeEnabled: settings.tailscaleServeEnabled,
			tailscaleServePort: Int(settings.tailscaleServePort)
		)
		var data = try JSONEncoder().encode(b)
		data.append(0x0a)
		return data
	}

	// MARK: - Core

	static func startCore(runtime: Runtime) throws -> CoreProcess {
		let process = Process()
		process.executableURL = runtime.node
		process.arguments = ["--experimental-eventsource", runtime.coreEntry.path]
		process.currentDirectoryURL = runtime.root
		let stdinPipe = Pipe()
		let stdoutPipe = Pipe()
		process.standardInput = stdinPipe
		process.standardOutput = stdoutPipe
		process.standardError = FileHandle.standardError
		if let bundle = runtime.bundle {
			process.environment?[appBundleEnv] = bundle.path
		} else {
			process.environment?.removeValue(forKey: appBundleEnv)
		}
		try process.run()
		track(process.processIdentifier)
		return CoreProcess(stdin: stdinPipe.fileHandleForWriting, stdout: stdoutPipe.fileHandleForReading)
	}

	// MARK: - Lifecycle

	private static func track(_ pid: pid_t) {
		childrenLock.lock()
		defer { childrenLock.unlock() }
		children.append(pid)
	}

	private static func exited(pid: pid_t) -> Bool {
		childrenLock.lock()
		defer { childrenLock.unlock() }
		guard children.contains(pid) else { return false }
		var status: Int32 = 0
		let result = waitpid(pid, &status, WNOHANG)
		if result == pid {
			lastExitStatus = status
		}
		return result == pid
	}

	static func stopAll() {
		childrenLock.lock()
		let pids = Backend.children
		Backend.children.removeAll()
		childrenLock.unlock()
		for pid in pids.reversed() {
			kill(pid, SIGTERM)
		}
		let deadline = Date().addingTimeInterval(stopGrace)
		for pid in pids {
			while true {
				var status: Int32 = 0
				let result = waitpid(pid, &status, WNOHANG)
				if result == pid { break }
				if result == 0 {
					if Date() >= deadline {
						kill(pid, SIGKILL)
						waitpid(pid, &status, 0)
					}
					Thread.sleep(forTimeInterval: 0.05)
				} else {
					break
				}
			}
		}
	}
}

// MARK: - Launch settings

struct LaunchSettings {
	var localEnvironmentEnabled: Bool = true
	var serverExposureMode: String = "local-only"
	var tailscaleServeEnabled: Bool = false
	var tailscaleServePort: UInt16 = 443
}

func desktopLaunchSettings(home: URL) -> LaunchSettings {
	let path = home.appendingPathComponent("userdata/desktop-settings.json")
	guard let data = try? Data(contentsOf: path),
		  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
	else { return LaunchSettings() }
	var s = LaunchSettings()
	if let v = json["localEnvironmentEnabled"] as? Bool { s.localEnvironmentEnabled = v }
	if let v = json["serverExposureMode"] as? String { s.serverExposureMode = v }
	if let v = json["tailscaleServeEnabled"] as? Bool { s.tailscaleServeEnabled = v }
	if let v = json["tailscaleServePort"] as? Int { s.tailscaleServePort = UInt16(v) }
	return s
}

// MARK: - Helpers

private func bootstrapToken() throws -> String {
	var bytes = [UInt8](repeating: 0, count: 24)
	let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
	guard status == errSecSuccess else {
		throw BackendError.message("cannot draw bootstrap token")
	}
	return bytes.map { String(format: "%02x", $0) }.joined()
}

private func canListen(port: UInt16) -> Bool {
	for host in ["127.0.0.1", "0.0.0.0"] {
		var addr = sockaddr_in()
		addr.sin_family = sa_family_t(AF_INET)
		addr.sin_port = in_port_t(port).bigEndian
		addr.sin_addr.s_addr = host == "127.0.0.1" ? inet_addr("127.0.0.1") : 0
		let fd = socket(AF_INET, SOCK_STREAM, 0)
		if fd < 0 { return false }
		var one: Int32 = 1
		setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
		let result = withUnsafePointer(to: &addr) { ptr in
			ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
				bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
			}
		}
		close(fd)
		if result != 0 { return false }
	}
	return true
}

private func freePort() throws -> UInt16 {
	for port in defaultPort...UInt16.max {
		if canListen(port: port) { return port }
	}
	throw BackendError.message("no free port from \(defaultPort)")
}

private func logFile(home: URL, name: String) throws -> FileHandle {
	let dir = home.appendingPathComponent("logs")
	try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
	let path = dir.appendingPathComponent(name)
	if !FileManager.default.fileExists(atPath: path.path) {
		FileManager.default.createFile(atPath: path.path, contents: nil)
	}
	let handle = try FileHandle(forWritingTo: path)
	try handle.seekToEnd()
	return handle
}

private func hasNetworkIPv4() -> Bool {
	var addresses: UnsafeMutablePointer<ifaddrs>?
	guard getifaddrs(&addresses) == 0, let first = addresses else { return false }
	defer { freeifaddrs(addresses) }
	var cursor: UnsafeMutablePointer<ifaddrs>? = first
	while let c = cursor {
		let addr = c.pointee.ifa_addr
		if let addr, Int32(addr.pointee.sa_family) == AF_INET {
			let sin = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
			let ip = UInt32(bigEndian: sin.sin_addr.s_addr)
			if !(ip == 0x7f00_0001 || (ip & 0xffc0_0000) == 0xa900_0000 || ip == 0) {
				return true
			}
		}
		cursor = c.pointee.ifa_next
	}
	return false
}

private func bindHost(settings: LaunchSettings) -> String {
	if settings.serverExposureMode == "network-accessible" && hasNetworkIPv4() {
		return "0.0.0.0"
	}
	return "127.0.0.1"
}

private func ready(port: UInt16) -> Bool {
	let host = "127.0.0.1"
	var addr = sockaddr_in()
	addr.sin_family = sa_family_t(AF_INET)
	addr.sin_port = in_port_t(port).bigEndian
	addr.sin_addr.s_addr = inet_addr(host)
	let fd = socket(AF_INET, SOCK_STREAM, 0)
	if fd < 0 { return false }
	defer { close(fd) }
	var tv = timeval(tv_sec: 1, tv_usec: 0)
	setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
	let result = withUnsafePointer(to: &addr) { ptr in
		ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) {
			connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
		}
	}
	if result != 0 { return false }
	let request = "GET \(readinessPath) HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nConnection: close\r\n\r\n"
	request.withCString { _ = write(fd, $0, strlen($0)) }
	var head = [UInt8](repeating: 0, count: 16)
	var bytesRead = 0
	while bytesRead < head.count {
		let n = read(fd, &head[bytesRead], head.count - bytesRead)
		if n <= 0 { break }
		bytesRead += n
	}
	let line = String(bytes: head[0..<bytesRead], encoding: .utf8) ?? ""
	return line.hasPrefix("HTTP/1.1 2") || line.hasPrefix("HTTP/1.0 2")
}
