import AppKit
import LocalStudioKit
import SwiftUI
import UniformTypeIdentifiers

/// `+motion <dir> [filter]`: plays each deliberate animation in a small on-screen window under the app's
/// animation switch-off, captures the rendered layers every frame and checks that the motion plays, can be
/// interrupted, settles without looping, stays still on repeated actions and is off under Reduce Motion.
/// Writes a frame strip per run (`motion-<scene>-<run>.png`).
@MainActor
enum MotionCheck {
    private struct Stage {
        let store: StudioStore
        let window: NSWindow
        let host: NSView
    }

    /// What a second action part-way through the motion must do.
    private enum Interrupt {
        /// Reverses mid-way: moves back through in-between frames to the start without reaching the end.
        case reverse
        /// Cancels mid-way: returns to the start without reaching the end.
        case cancel
        /// Repeats mid-way: carries on to the end without restarting from the start.
        case retrigger
    }

    private struct Scene {
        let name: String
        let size: CGSize
        let crop: CGRect
        let updates: [Update]
        let view: @MainActor (StudioStore) -> AnyView
        let forward: @MainActor (Stage) -> Void
        var interrupt: (Interrupt, @MainActor (Stage) -> Void)?
        /// The repeated forward action must leave every pixel alone.
        var repeats = false
        /// False for instant changes that must never animate.
        var animates = true
        var duration = 1.2
        /// Frames from here on must already show the end state: the motions run at most 0.3 s, a symbol bounce
        /// about 0.55 s after it starts.
        var settledAfter = 0.6
        /// When the interrupting action comes: part-way through the visible motion.
        var interruptAfter = 0.1
        /// The state a second later: the end (held) or the start (a confirmation that times out).
        var restsAtStart = false
    }

    private struct Run {
        var frames: [CGImage] = []
        var times: [Double] = []
        var start: CGImage?
        var end: CGImage?
        var later: CGImage?
        var interruptedAt: Int?
    }

    private static let interval = 1.0 / 120

    static func run(into directory: URL, matching filter: String?) -> Int32 {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            print("FAIL motion: \(error.localizedDescription)")
            return 1
        }
        var failures = 0
        let selected = scenes.filter { scene in filter.map { scene.name.contains($0) } ?? true }
        for scene in selected {
            failures += check(scene, into: directory)
        }
        Motion.reducedOverride = nil
        print(failures == 0 ? "PASS motion: \(selected.count) scenes" : "FAIL motion: \(failures) checks failed")
        return failures == 0 ? 0 : 1
    }

    private static func check(_ scene: Scene, into directory: URL) -> Int {
        var failures = 0
        let report = { (name: String, passed: Bool, detail: String) in
            print("\(passed ? "ok  " : "FAIL") \(scene.name) \(name): \(detail)")
            if !passed { failures += 1 }
        }
        Motion.reducedOverride = false
        let played = record(scene, interrupt: false)
        let steps = intermediates(played)
        let changed = difference(played.end, played.start) > 0
        let gap = Int(gap(played) * 1000)
        if scene.animates {
            report("plays", steps >= 3 && changed, "\(steps) in-between frames of \(played.frames.count), median capture gap \(gap) ms")
        } else {
            report("is instant", steps == 0 && changed, "\(steps) in-between frames of \(played.frames.count), median capture gap \(gap) ms")
        }
        let settledAfter = scene.settledAfter
        let late = zip(played.times, played.frames).filter { $0.0 >= settledAfter }.map(\.1)
        let moving = late.filter { difference($0, played.end) > 0 }.count
        report("settles", !late.isEmpty && moving == 0, moving == 0 ? "\(late.count) frames after \(Int(settledAfter * 1000)) ms all match the end state" : "\(moving) of \(late.count) frames after \(Int(settledAfter * 1000)) ms still differ from the end state")
        let rest = scene.restsAtStart ? played.start : played.end
        let looped = difference(played.later, rest)
        report("no loop", looped == 0, looped == 0 ? "a second later it rests at the \(scene.restsAtStart ? "start" : "end") state" : "a second later \(looped) pixels differ from the \(scene.restsAtStart ? "start" : "end") state")
        write(played, scene: scene, suffix: "play", into: directory)
        if let kind = scene.interrupt?.0 {
            let cut = record(scene, interrupt: true)
            let after = cut.interruptedAt.map { Array(cut.frames[$0...]) } ?? []
            let reachedEnd = after.contains { difference($0, played.end) == 0 }
            let restarted = after.contains { difference($0, cut.start) == 0 }
            let backSteps = after.filter { difference($0, cut.start) > 0 && difference($0, played.end) > 0 }.count
            let home = difference(cut.end, cut.start) == 0
            switch kind {
            case .reverse:
                report("reverses mid-way", !reachedEnd && backSteps >= 2 && home, "\(backSteps) in-between frames after the reversal, end state \(reachedEnd ? "reached" : "never reached"), \(home ? "back at the start" : "not back at the start")")
            case .cancel:
                report("cancels mid-way", !reachedEnd && home, "end state \(reachedEnd ? "reached" : "never reached") after the cancel, \(home ? "back at the start" : "not back at the start")")
            case .retrigger:
                let atEnd = difference(cut.end, played.end) == 0
                report("repeats mid-way", !restarted && atEnd, "\(restarted ? "restarted from the start" : "carried on") after the second action, \(atEnd ? "ends at the end state" : "does not end at the end state")")
            }
            write(cut, scene: scene, suffix: "interrupt", into: directory)
        }
        if scene.repeats {
            let again = recordRepeat(scene)
            let moved = again.frames.filter { difference($0, again.start) > 0 }.count
            report("repeat is still", moved == 0, "\(moved) frames changed on the repeated action")
            write(again, scene: scene, suffix: "repeat", into: directory)
        }
        if scene.animates {
            Motion.reducedOverride = true
            let reduced = record(scene, interrupt: false)
            let reducedSteps = intermediates(reduced)
            report("reduce motion", reducedSteps == 0 && difference(reduced.end, reduced.start) > 0, "\(reducedSteps) in-between frames")
            write(reduced, scene: scene, suffix: "reduced", into: directory)
        }
        return failures
    }

    private static func gap(_ run: Run) -> Double {
        let gaps = zip(run.times.dropFirst(), run.times).map { $0 - $1 }.sorted()
        return gaps.isEmpty ? 0 : gaps[gaps.count / 2]
    }

    private static func intermediates(_ run: Run) -> Int {
        run.frames.filter { difference($0, run.start) > 0 && difference($0, run.end) > 0 }.count
    }

    private static func stage(_ scene: Scene) -> Stage {
        let store = StudioStore(launch: nil)
        store.receive(scene.updates)
        let frame = NSRect(origin: .zero, size: scene.size)
        let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingView(rootView: scene.view(store)
            .frame(width: scene.size.width, height: scene.size.height)
            .background(Theme.canvas)
            .transaction { $0.disablesAnimations = true })
        host.frame = frame
        window.contentView = host
        if let screen = NSScreen.main {
            window.setFrameOrigin(NSPoint(x: screen.visibleFrame.minX, y: screen.visibleFrame.minY))
        }
        window.orderFrontRegardless()
        settle(0.6)
        return Stage(store: store, window: window, host: host)
    }

    private static func record(_ scene: Scene, interrupt: Bool) -> Run {
        let stage = stage(scene)
        var run = Run()
        run.start = capture(stage.host, crop: scene.crop)
        scene.forward(stage)
        let began = Date.now
        var interrupted = false
        while Date.now.timeIntervalSince(began) < scene.duration {
            settle(interval)
            if interrupt, !interrupted, Date.now.timeIntervalSince(began) >= scene.interruptAfter, let action = scene.interrupt?.1 {
                action(stage)
                interrupted = true
                run.interruptedAt = run.frames.count
            }
            if let image = capture(stage.host, crop: scene.crop) {
                run.frames.append(image)
                run.times.append(Date.now.timeIntervalSince(began))
            }
        }
        settle(0.5)
        run.end = capture(stage.host, crop: scene.crop)
        if !interrupt {
            settle(1.2)
            run.later = capture(stage.host, crop: scene.crop)
        }
        stage.window.close()
        return run
    }

    private static func recordRepeat(_ scene: Scene) -> Run {
        let stage = stage(scene)
        scene.forward(stage)
        settle(1)
        var run = Run()
        run.start = capture(stage.host, crop: scene.crop)
        scene.forward(stage)
        let began = Date.now
        while Date.now.timeIntervalSince(began) < 0.4 {
            settle(interval)
            if let image = capture(stage.host, crop: scene.crop) {
                run.frames.append(image)
                run.times.append(Date.now.timeIntervalSince(began))
            }
        }
        run.end = capture(stage.host, crop: scene.crop)
        stage.window.close()
        return run
    }

    private static func settle(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date(timeIntervalSinceNow: seconds))
    }

    private static func capture(_ view: NSView, crop: CGRect) -> CGImage? {
        guard let layer = view.layer else { return nil }
        let scale: CGFloat = 2
        let width = Int(crop.width * scale)
        let height = Int(crop.height * scale)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.scaleBy(x: scale, y: scale)
        if layer.isGeometryFlipped || view.isFlipped {
            context.translateBy(x: 0, y: crop.height)
            context.scaleBy(x: 1, y: -1)
            context.translateBy(x: -crop.minX, y: -crop.minY)
        } else {
            context.translateBy(x: -crop.minX, y: -(view.bounds.height - crop.maxY))
        }
        (layer.presentation() ?? layer).render(in: context)
        return context.makeImage()
    }

    private static func difference(_ lhs: CGImage?, _ rhs: CGImage?) -> Int {
        guard let lhs, let rhs, let left = pixels(lhs), let right = pixels(rhs), left.count == right.count else { return Int.max }
        var changed = 0
        left.withUnsafeBufferPointer { a in
            right.withUnsafeBufferPointer { b in
                var index = 0
                while index < a.count {
                    let delta = max(abs(Int(a[index]) - Int(b[index])), abs(Int(a[index + 1]) - Int(b[index + 1])), abs(Int(a[index + 2]) - Int(b[index + 2])))
                    if delta > 24 { changed += 1 }
                    index += 4
                }
            }
        }
        return changed > 6 ? changed : 0
    }

    private static func pixels(_ image: CGImage) -> [UInt8]? {
        let width = image.width
        let height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? bytes : nil
    }

    /// Writes the start, up to 14 frames spread over the span in which the frames change, and the end, in a grid
    /// read left to right, top to bottom.
    private static func write(_ run: Run, scene: Scene, suffix: String, into directory: URL) {
        let moving = run.frames.indices.filter { difference(run.frames[$0], run.start) > 0 }
        let last = run.frames.count - 1
        let span = moving.first.map { max($0 - 1, 0)...min((run.frames.indices.last { difference(run.frames[$0], run.end) > 0 } ?? $0) + 1, last) }
            ?? (last >= 0 ? 0...last : nil)
        let picked = span.map { span in stride(from: span.lowerBound, through: span.upperBound, by: max((span.count + 13) / 14, 1)).map { run.frames[$0] } } ?? []
        let images = [run.start].compactMap(\.self) + picked + [run.end].compactMap(\.self)
        guard let first = images.first else { return }
        let gap = 4
        let columns = max(1, min(images.count, 2_400 / (first.width + gap)))
        let rows = (images.count + columns - 1) / columns
        let width = columns * (first.width + gap)
        let height = rows * (first.height + gap)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        context.setFillColor(NSColor.systemPink.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        for (index, image) in images.enumerated() {
            let column = index % columns
            let row = index / columns
            context.draw(image, in: CGRect(x: column * (first.width + gap), y: height - (row + 1) * (first.height + gap), width: image.width, height: image.height))
        }
        let url = directory.appendingPathComponent("motion-\(scene.name)-\(suffix).png")
        guard let strip = context.makeImage(), let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(destination, strip, nil)
        if CGImageDestinationFinalize(destination) {
            print("strip \(url.path) (\(images.count) frames)")
        }
    }

    private static var rows: [ThreadRow] {
        ShellFixtures.threads.map { row in
            var row = row
            if row.status == .working || row.status == .monitoring {
                row.status = .done
            }
            row.updatedAt += 90_000
            return row
        }
    }

    private static func moved(_ rows: [ThreadRow]) -> [ThreadRow] {
        var rows = rows
        guard let index = rows.firstIndex(where: { $0.id == "t-active-6" }), let first = rows.firstIndex(where: { $0.shelf == .active }) else { return rows }
        let row = rows.remove(at: index)
        rows.insert(row, at: first)
        return rows
    }

    private static func status(_ rows: [ThreadRow], _ id: String, _ status: ThreadStatus) -> [ThreadRow] {
        rows.map { row in
            var row = row
            if row.id == id { row.status = status }
            return row
        }
    }

    private static var shell: [Update] {
        [.connection(state: .ready), .projects(projects: ShellFixtures.projects), .threads(threads: rows), .keybindings(bindings: ShellFixtures.keybindings)]
    }

    private static var scenes: [Scene] {
        let sidebar = CGSize(width: 288, height: 520)
        let rowsCrop = CGRect(x: 0, y: 60, width: 288, height: 340)
        let toast = CGSize(width: 600, height: 120)
        let notice = "Motion check: the toast slides in from the top and back out."
        return [
            Scene(
                name: "sidebar-reorder", size: sidebar, crop: rowsCrop, updates: shell,
                view: { AnyView(SidebarView(store: $0)) },
                forward: { $0.store.receive([.threads(threads: moved(rows))]) },
                interrupt: (.reverse, { $0.store.receive([.threads(threads: rows)]) }),
                repeats: true
            ),
            Scene(
                name: "sidebar-select", size: sidebar, crop: rowsCrop, updates: shell,
                view: { AnyView(SidebarView(store: $0)) },
                forward: { $0.store.select("t-active-3") },
                repeats: true,
                animates: false,
                duration: 0.8
            ),
            Scene(
                name: "attention-bounce", size: sidebar, crop: CGRect(x: 196, y: 212, width: 92, height: 32), updates: shell,
                view: { AnyView(SidebarView(store: $0)) },
                forward: { $0.store.receive([.threads(threads: status(rows, "t-active-1", .approval))]) },
                interrupt: (.cancel, { $0.store.receive([.threads(threads: rows)]) }),
                repeats: true,
                settledAfter: 0.9,
                interruptAfter: 0.35
            ),
            Scene(
                name: "copy-confirm", size: CGSize(width: 120, height: 60), crop: CGRect(x: 0, y: 0, width: 120, height: 60), updates: [],
                view: { _ in AnyView(CopyButton(text: "motion check").frame(maxWidth: .infinity, maxHeight: .infinity)) },
                forward: { click($0) },
                interrupt: (.retrigger, { click($0) }),
                repeats: true,
                duration: 0.8,
                interruptAfter: 0.25,
                restsAtStart: true
            ),
            Scene(
                name: "toast-in", size: toast, crop: CGRect(origin: .zero, size: toast), updates: [],
                view: { AnyView(ToastLayer(store: $0).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)) },
                forward: { $0.store.post(.error, notice) },
                interrupt: (.reverse, { $0.store.dismissNotice() }),
                interruptAfter: 0.2
            ),
            Scene(
                name: "toast-out", size: toast, crop: CGRect(origin: .zero, size: toast), updates: [.notice(level: .error, text: notice)],
                view: { AnyView(ToastLayer(store: $0).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)) },
                forward: { $0.store.dismissNotice() },
                interrupt: (.reverse, { $0.store.post(.error, notice) })
            ),
        ]
    }

    private static func click(_ stage: Stage) {
        let point = NSPoint(x: stage.host.bounds.midX, y: stage.host.bounds.midY)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: stage.window.windowNumber,
                context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0
            ) else { continue }
            stage.window.sendEvent(event)
        }
    }
}
