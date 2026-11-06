import Foundation

// Headless end-to-end check: spawn the server + core, connect, wait for the
// core to report ready and deliver the app-shell view, then verify an action
// round-trips (the core responds with a result). Exits 0 on success, 1 on
// failure. Used for CI and local verification without a GUI.
func runSmoke() -> Never {
	let deadline = Date().addingTimeInterval(90)
	var ready = false
	var gotShell = false
	var shellRoute = ""
	var gotResult = false
	var resultOk = false
	var resultError = ""

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
			appearance: "dark"
		)
		let client = CoreClient.start(process: core, hello: hello)

		client.subscribe(view: "app-shell") { (v: AppShellView) in
			gotShell = true
			shellRoute = describeRoute(v.route)
		}
		client.onResult = { _, ok, error in
			gotResult = true
			resultOk = ok
			resultError = error ?? ""
		}

		var actionSent = false
		while Date() < deadline {
			RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.2))
			ready = client.ready
			if ready && gotShell && !actionSent {
				client.act("closeModelPicker", params: .object([:]))
				actionSent = true
			}
			if ready && gotShell && gotResult { break }
		}

		Backend.stopAll()

		if ready && gotShell && gotResult {
			print("SMOKE OK route=\(shellRoute) resultOk=\(resultOk) resultError=\(resultError)")
			exit(0)
		} else {
			print("SMOKE FAIL ready=\(ready) shell=\(gotShell) result=\(gotResult) ok=\(resultOk) err=\(resultError)")
			exit(1)
		}
	} catch {
		Backend.stopAll()
		print("SMOKE FAIL error=\(error.localizedDescription)")
		exit(1)
	}
}

func describeRoute(_ route: AppShellRoute) -> String {
	switch route {
	case .home: return "home"
	case .thread(let env, let thread): return "thread:\(env)/\(thread)"
	case .draft(let id): return "draft:\(id)"
	case .settings(let section): return "settings:\(section)"
	case .usage: return "usage"
	case .pullRequests: return "pull-requests"
	case .project(let key): return "project:\(key)"
	case .welcome: return "welcome"
	case .pair: return "pair"
	case .connect: return "connect"
	}
}
