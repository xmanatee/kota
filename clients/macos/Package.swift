// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "KotaMenuBar",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "KotaMenuBar",
            path: "Sources/KotaMenuBar"
        ),
        .testTarget(
            name: "KotaMenuBarTests",
            dependencies: ["KotaMenuBar"],
            path: "Tests/KotaMenuBarTests",
            resources: [
                .copy("contract-fixture.json"),
                .copy("RecallEmptyStateSnapshot.txt"),
            ]
        )
    ]
)
