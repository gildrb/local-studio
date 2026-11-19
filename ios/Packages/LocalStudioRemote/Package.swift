// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "LocalStudioRemote",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "LocalStudioRemote", targets: ["LocalStudioRemote"]),
    ],
    targets: [
        .target(name: "LocalStudioRemote"),
        .testTarget(name: "LocalStudioRemoteTests", dependencies: ["LocalStudioRemote"]),
    ]
)
