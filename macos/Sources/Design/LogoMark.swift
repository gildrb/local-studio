import AppKit
import QuartzCore
import SwiftUI

@MainActor
enum LogoGeometry {
    static let extent: CGFloat = 525
    private static let lobe: CGFloat = 87
    private static let topLeft = CGPoint(x: 196.9, y: 187.0)
    private static let topRight = CGPoint(x: 327.1, y: 187.0)
    private static let bottomLeft = CGPoint(x: 131.7, y: 299.9)
    private static let bottomRight = CGPoint(x: 392.3, y: 299.9)
    private static let base = CGRect(x: 131.7, y: 244, width: 392.3 - 131.7, height: 386.7 - 244)

    static let disc = circle(CGPoint(x: 262.008, y: 262.008), 262.008)
    static let cloud: CGPath = [topRight, bottomLeft, bottomRight]
        .reduce(circle(topLeft, lobe)) { $0.union(circle($1, lobe)) }
        .union(CGPath(rect: base, transform: nil))
    static let leaves: [CGPath] = [
        circle(topLeft, lobe).intersection(circle(bottomLeft, lobe)),
        circle(topLeft, lobe).intersection(circle(topRight, lobe)),
        circle(topRight, lobe).intersection(circle(bottomRight, lobe)),
    ]
    static let mark: CGPath = leaves.reduce(disc.subtracting(cloud)) { $0.union($1) }
    static let cloudBox = cloud.boundingBoxOfPath
    static let markBox = CGRect(x: 0, y: 0, width: extent, height: extent)

    private static func circle(_ center: CGPoint, _ radius: CGFloat) -> CGPath {
        CGPath(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2), transform: nil)
    }

    static func fit(_ box: CGRect, in bounds: CGRect) -> CGAffineTransform {
        let scale = min(bounds.width / box.width, bounds.height / box.height)
        let x = bounds.minX + (bounds.width - box.width * scale) / 2
        let y = bounds.minY + (bounds.height - box.height * scale) / 2
        return CGAffineTransform(translationX: -box.minX, y: -box.minY)
            .concatenating(CGAffineTransform(scaleX: scale, y: -scale))
            .concatenating(CGAffineTransform(translationX: x, y: y + box.height * scale))
    }
}

enum LogoMotion {
    static let leavesDuration: CFTimeInterval = 1.4
    static let leafDelay: CFTimeInterval = 0.2
    static let leafTimes: [Double] = [0, 0.2, 0.45, 1]
    static let leafOpacity: [Double] = [0.3, 1, 0.3, 0.3]
    static let leafScale: [Double] = [0.86, 1.14, 0.92, 0.86]
    static let cloudOpacity: Float = 0.22
    static let leavesRest: CFTimeInterval = 1.2
    static let leafRestOpacity: Float = 0.3
    static let leafRestScale: CGFloat = 0.86

    static let coinDuration: CFTimeInterval = 2.6
    static let coinTimes: [Double] = [0, 0.34, 0.5, 0.84, 1]
    static let coinAngles: [Double] = [0, .pi, .pi, 2 * .pi, 2 * .pi]
    static let coinRest: CFTimeInterval = 2.4

    static func sample(_ times: [Double], _ values: [Double], at fraction: Double, eased: Bool) -> Double {
        let clamped = min(max(fraction, 0), 1)
        guard let upper = times.firstIndex(where: { $0 >= clamped }), upper > 0 else { return values.first ?? 0 }
        let span = times[upper] - times[upper - 1]
        let local = span > 0 ? (clamped - times[upper - 1]) / span : 1
        let progress = eased ? easeInOut(local) : local
        return values[upper - 1] + (values[upper] - values[upper - 1]) * progress
    }

    static func leafFraction(_ index: Int, at time: CFTimeInterval) -> Double {
        let local = time - Double(index) * leafDelay
        guard local > 0 else { return 0 }
        return local.truncatingRemainder(dividingBy: leavesDuration) / leavesDuration
    }

    private static func easeInOut(_ x: Double) -> Double {
        var low = 0.0
        var high = 1.0
        var t = x
        for _ in 0..<24 {
            t = (low + high) / 2
            if bezier(t, 0.42, 0.58) < x { low = t } else { high = t }
        }
        return bezier(t, 0, 1)
    }

    private static func bezier(_ t: Double, _ first: Double, _ second: Double) -> Double {
        let inverse = 1 - t
        return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
    }
}

final class LogoMarkView: NSView {
    enum Style {
        case leaves
        case coin
    }

    var style: Style {
        didSet {
            guard style != oldValue else { return }
            stopAnimating()
            needsLayout = true
        }
    }

    var tint: NSColor = .controlAccentColor {
        didSet {
            if tint != oldValue { recolor() }
        }
    }

    var paused = false {
        didSet {
            guard paused != oldValue else { return }
            pose()
            updateAnimation()
        }
    }

    private let stage = CALayer()
    private let body = CAShapeLayer()
    private let leaves = (0..<3).map { _ in CAShapeLayer() }
    private var animating = false

    init(style: Style) {
        self.style = style
        super.init(frame: .zero)
        wantsLayer = true
        layer?.addSublayer(stage)
        stage.addSublayer(body)
        leaves.forEach(stage.addSublayer)
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(motionPreferenceChanged(_:)),
            name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil
        )
        setAccessibilityElement(false)
        recolor()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var isFlipped: Bool {
        false
    }

    override func layout() {
        super.layout()
        place()
        updateAnimation()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        updateAnimation()
    }

    override func viewDidHide() {
        super.viewDidHide()
        updateAnimation()
    }

    override func viewDidUnhide() {
        super.viewDidUnhide()
        updateAnimation()
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        recolor()
    }

    @objc private func motionPreferenceChanged(_ notification: Notification) {
        pose()
        updateAnimation()
    }

    private var shouldAnimate: Bool {
        guard !paused, window != nil, !isHiddenOrHasHiddenAncestor, bounds.width > 0 else { return false }
        return !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }

    private func pose() {
        let resting = paused && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let scale = resting ? LogoMotion.leafRestScale : 1
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for leaf in leaves {
            leaf.opacity = resting ? LogoMotion.leafRestOpacity : 1
            leaf.transform = CATransform3DMakeScale(scale, scale, 1)
        }
        CATransaction.commit()
    }

    private func updateAnimation() {
        let should = shouldAnimate
        guard should != animating else { return }
        if should { startAnimating() } else { stopAnimating() }
    }

    private func place() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        stage.frame = bounds
        body.frame = bounds
        switch style {
        case .leaves:
            var fit = LogoGeometry.fit(LogoGeometry.cloudBox, in: bounds)
            body.path = LogoGeometry.cloud.copy(using: &fit)
            body.opacity = LogoMotion.cloudOpacity
            stage.sublayerTransform = CATransform3DIdentity
            for (layer, leaf) in zip(leaves, LogoGeometry.leaves) {
                guard let path = leaf.copy(using: &fit) else { continue }
                let box = path.boundingBoxOfPath
                var shift = CGAffineTransform(translationX: -box.minX, y: -box.minY)
                layer.bounds = CGRect(origin: .zero, size: box.size)
                layer.position = CGPoint(x: box.midX, y: box.midY)
                layer.path = path.copy(using: &shift)
                layer.isHidden = false
            }
        case .coin:
            var fit = LogoGeometry.fit(LogoGeometry.markBox, in: bounds)
            body.path = LogoGeometry.mark.copy(using: &fit)
            body.opacity = 1
            var perspective = CATransform3DIdentity
            perspective.m34 = -1 / max(bounds.width * 3, 1)
            stage.sublayerTransform = perspective
            leaves.forEach { $0.isHidden = true }
        }
    }

    private func recolor() {
        var color = tint.cgColor
        effectiveAppearance.performAsCurrentDrawingAppearance {
            color = tint.cgColor
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        body.fillColor = color
        leaves.forEach { $0.fillColor = color }
        CATransaction.commit()
    }

    private func startAnimating() {
        animating = true
        let now = stage.convertTime(CACurrentMediaTime(), from: nil)
        switch style {
        case .leaves:
            for (index, leaf) in leaves.enumerated() {
                let opacity = keyframes("opacity", LogoMotion.leafOpacity, times: LogoMotion.leafTimes)
                let scale = keyframes("transform.scale", LogoMotion.leafScale, times: LogoMotion.leafTimes)
                let group = CAAnimationGroup()
                group.animations = [opacity, scale]
                group.duration = LogoMotion.leavesDuration
                group.repeatCount = .infinity
                group.beginTime = now - LogoMotion.leavesRest + Double(index) * LogoMotion.leafDelay
                group.fillMode = .backwards
                leaf.add(group, forKey: "pulse")
            }
        case .coin:
            let flip = keyframes("transform.rotation.y", LogoMotion.coinAngles, times: LogoMotion.coinTimes)
            flip.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: LogoMotion.coinTimes.count - 1)
            flip.duration = LogoMotion.coinDuration
            flip.repeatCount = .infinity
            flip.beginTime = now - LogoMotion.coinRest
            body.add(flip, forKey: "flip")
        }
    }

    private func stopAnimating() {
        animating = false
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        body.removeAllAnimations()
        leaves.forEach { $0.removeAllAnimations() }
        CATransaction.commit()
    }

    private func keyframes(_ path: String, _ values: [Double], times: [Double]) -> CAKeyframeAnimation {
        let animation = CAKeyframeAnimation(keyPath: path)
        animation.values = values
        animation.keyTimes = times.map { NSNumber(value: $0) }
        return animation
    }
}

struct LogoMark: NSViewRepresentable {
    var style: LogoMarkView.Style = .leaves
    var tint: Color = Theme.primary

    func makeNSView(context: Context) -> LogoMarkView {
        let view = LogoMarkView(style: style)
        view.tint = NSColor(tint)
        view.paused = !context.environment.windowActivity.animates
        return view
    }

    func updateNSView(_ view: LogoMarkView, context: Context) {
        view.style = style
        view.tint = NSColor(tint)
        view.paused = !context.environment.windowActivity.animates
    }
}
