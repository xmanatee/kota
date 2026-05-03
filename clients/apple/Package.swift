// swift-tools-version: 5.9
import PackageDescription

// Single Swift package contributing three targets that share the
// daemon transport, state container, and SwiftUI views:
//
//   - `KotaShared`  : library with `AppState`, the `DaemonClient`
//                     wrapper, the contract decoders, the platform-
//                     agnostic SwiftUI views, and the platform
//                     affordance protocols injected by the shells.
//   - `KotaMenuBar` : macOS menu-bar executable. Owns `MenuBarExtra`,
//                     the AppKit-backed `MacOSPlatform`, and the
//                     macOS notification surface.
//   - `KotaiOS`     : iOS executable. Owns the `WindowGroup` /
//                     `TabView` shell and the UIKit-backed
//                     `iOSPlatform` / iOS notification surface.
//
// Tests split the same way: `KotaSharedTests` exercises the shared
// view-model + decoder logic against the canonical contract fixture
// and a recording notification stub; `KotaMenuBarTests` keeps the
// macOS-specific rendered-IA snapshot.
let package = Package(
    name: "KotaApple",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "KotaShared", targets: ["KotaShared"]),
        .executable(name: "KotaMenuBar", targets: ["KotaMenuBar"]),
        .executable(name: "KotaiOS", targets: ["KotaiOS"]),
    ],
    targets: [
        .target(
            name: "KotaShared",
            path: "Sources/KotaShared"
        ),
        .executableTarget(
            name: "KotaMenuBar",
            dependencies: ["KotaShared"],
            path: "Sources/KotaMenuBar"
        ),
        .executableTarget(
            name: "KotaiOS",
            dependencies: ["KotaShared"],
            path: "Sources/KotaiOS"
        ),
        .testTarget(
            name: "KotaSharedTests",
            dependencies: ["KotaShared"],
            path: "Tests/KotaSharedTests",
            resources: [
                .copy("contract-fixture.json"),
                .copy("RecallEmptyStateSnapshot.txt"),
            ]
        ),
        .testTarget(
            name: "KotaMenuBarTests",
            dependencies: ["KotaShared"],
            path: "Tests/KotaMenuBarTests"
        ),
    ]
)
