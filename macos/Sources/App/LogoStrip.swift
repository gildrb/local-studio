import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor
enum LogoStrip {
    private static let frames = 12
    private static let cell: CGFloat = 64
    private static let sizes: [CGFloat] = [12, 16, 24]
    private static let scale: CGFloat = 2

    static func write(into directory: URL) -> [URL] {
        var written: [URL] = []
        for (name, style) in [("leaves", LogoMarkView.Style.leaves), ("coin", .coin)] {
            for (suffix, appearance) in [("dark", NSAppearance.Name.darkAqua), ("light", .aqua)] {
                guard let appearance = NSAppearance(named: appearance), let image = render(style, appearance: appearance) else { continue }
                let url = directory.appendingPathComponent("logo-\(name)-\(suffix).png")
                guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { continue }
                CGImageDestinationAddImage(destination, image, nil)
                if CGImageDestinationFinalize(destination) {
                    written.append(url)
                }
            }
        }
        return written
    }

    private static func render(_ style: LogoMarkView.Style, appearance: NSAppearance) -> CGImage? {
        let columns = sizes.count + frames
        let width = Int(cell * CGFloat(columns) * scale)
        let height = Int(cell * scale)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.scaleBy(x: scale, y: scale)
        var background = NSColor.black.cgColor
        var tint = NSColor.white.cgColor
        appearance.performAsCurrentDrawingAppearance {
            background = NSColor(Theme.canvas).cgColor
            tint = NSColor(Theme.primary).cgColor
        }
        context.setFillColor(background)
        context.fill(CGRect(x: 0, y: 0, width: cell * CGFloat(columns), height: cell))
        for (index, size) in sizes.enumerated() {
            let rect = CGRect(x: cell * CGFloat(index) + (cell - size) / 2, y: (cell - size) / 2, width: size, height: size)
            draw(style, in: rect, time: nil, tint: tint, context: context)
        }
        let duration = style == .leaves ? LogoMotion.leavesDuration : LogoMotion.coinDuration
        for frame in 0..<frames {
            let rect = CGRect(x: cell * CGFloat(sizes.count + frame) + 8, y: 8, width: cell - 16, height: cell - 16)
            let time = duration * 2 + duration * Double(frame) / Double(frames)
            draw(style, in: rect, time: time, tint: tint, context: context)
        }
        return context.makeImage()
    }

    private static func draw(_ style: LogoMarkView.Style, in rect: CGRect, time: CFTimeInterval?, tint: CGColor, context: CGContext) {
        context.saveGState()
        defer { context.restoreGState() }
        context.setFillColor(tint)
        switch style {
        case .leaves:
            var fit = LogoGeometry.fit(LogoGeometry.cloudBox, in: rect)
            guard let cloud = LogoGeometry.cloud.copy(using: &fit) else { return }
            context.setAlpha(CGFloat(LogoMotion.cloudOpacity))
            context.addPath(cloud)
            context.fillPath()
            for (index, leaf) in LogoGeometry.leaves.enumerated() {
                guard let path = leaf.copy(using: &fit) else { continue }
                var opacity = 1.0
                var grow = 1.0
                if let time {
                    let fraction = LogoMotion.leafFraction(index, at: time)
                    opacity = LogoMotion.sample(LogoMotion.leafTimes, LogoMotion.leafOpacity, at: fraction, eased: false)
                    grow = LogoMotion.sample(LogoMotion.leafTimes, LogoMotion.leafScale, at: fraction, eased: false)
                }
                let box = path.boundingBoxOfPath
                var around = CGAffineTransform(translationX: -box.midX, y: -box.midY)
                    .concatenating(CGAffineTransform(scaleX: grow, y: grow))
                    .concatenating(CGAffineTransform(translationX: box.midX, y: box.midY))
                guard let scaled = path.copy(using: &around) else { continue }
                context.setAlpha(opacity)
                context.addPath(scaled)
                context.fillPath()
            }
        case .coin:
            var fit = LogoGeometry.fit(LogoGeometry.markBox, in: rect)
            if let time {
                let fraction = time.truncatingRemainder(dividingBy: LogoMotion.coinDuration) / LogoMotion.coinDuration
                let angle = LogoMotion.sample(LogoMotion.coinTimes, LogoMotion.coinAngles, at: fraction, eased: true)
                fit = fit.concatenating(CGAffineTransform(translationX: -rect.midX, y: -rect.midY))
                    .concatenating(CGAffineTransform(scaleX: cos(angle), y: 1))
                    .concatenating(CGAffineTransform(translationX: rect.midX, y: rect.midY))
            }
            guard let mark = LogoGeometry.mark.copy(using: &fit) else { return }
            context.addPath(mark)
            context.fillPath()
        }
    }
}
