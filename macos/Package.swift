// swift-tools-version:5.9
import Foundation
import PackageDescription

let packageDirectory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let infoPlist = packageDirectory.appendingPathComponent("LocalStudio-Info.plist").path
let kitLibrary = packageDirectory.appendingPathComponent("Generated/lib").path

let package = Package(
    name: "LocalStudio",
    platforms: [.macOS("26.0")],
    dependencies: [
        .package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.20.0"),
    ],
    targets: [
        .systemLibrary(
            name: "local_studio_coreFFI",
            path: "Generated/local_studio_coreFFI"
        ),
        .target(
            name: "LocalStudioKit",
            dependencies: ["local_studio_coreFFI"],
            path: "Generated/LocalStudioKit",
            linkerSettings: [
                .unsafeFlags(["-L", kitLibrary]),
                .linkedLibrary("local_studio_kit"),
                .linkedLibrary("iconv"),
            ]
        ),
        .executableTarget(
            name: "LocalStudio",
            dependencies: ["LocalStudioKit", .product(name: "SwiftTerm", package: "SwiftTerm")],
            path: "Sources",
            swiftSettings: [.enableExperimentalFeature("StrictConcurrency")],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlist,
                ])
            ]
        ),
    ]
)
