import Foundation

/// Operator-facing platform actions that have meaningfully different
/// implementations on macOS and iOS. `AppState` accepts these as
/// dependencies so the shared state container can be constructed
/// without referencing AppKit / UIKit / NSWorkspace / NSOpenPanel
/// directly. The macOS shell binds the AppKit-backed implementations;
/// the iOS shell binds equivalents that route through UIKit /
/// `UIApplication.shared.open` / scene-based settings; tests bind a
/// recording stub.
public protocol PlatformAffordances {
    /// Opens an operator-facing URL such as the daemon's web dashboard.
    /// Returns `false` when the platform refuses to handle the URL so
    /// the caller can surface a no-op instead of pretending it worked.
    @MainActor
    @discardableResult
    func openURL(_ url: URL) -> Bool

    /// Prompts the operator to select a project directory. Returns
    /// `nil` when the platform has no native picker (today: iOS, where
    /// `UIDocumentPicker` is sandboxed and the operator types the path
    /// in Settings instead). The macOS implementation runs an
    /// `NSOpenPanel`; the iOS implementation always returns `nil` and
    /// the iOS Settings pane writes `projectDir` directly.
    @MainActor
    func pickProjectDirectory() async -> URL?

    /// Opens the platform-native settings surface for the app. macOS
    /// dispatches to the `Settings` scene declared in the menu-bar
    /// app; iOS pushes the in-app settings tab. Implementations may
    /// no-op when the surface is not available in the current shell.
    @MainActor
    func openAppSettings()

    /// Returns `true` when the platform supports a programmatic quit
    /// affordance for the app. macOS sets this to `true`; iOS sets
    /// `false` because Apple does not allow third-party apps to
    /// terminate themselves.
    var supportsQuit: Bool { get }

    /// Returns `true` when `pickProjectDirectory()` opens a native
    /// folder picker that resolves to a real `URL`. macOS = `true`
    /// (NSOpenPanel); iOS = `false` (sandbox prevents arbitrary
    /// folder access — operator types the path in Settings).
    var supportsNativeProjectPicker: Bool { get }

    /// Quits the host app. Implementations may no-op when
    /// `supportsQuit` is `false` so the FooterActionsView can hide
    /// the affordance entirely on iOS.
    @MainActor
    func quitApp()
}

/// Default no-op affordances used by tests so `AppState` can be
/// constructed without binding either platform shell. Production
/// callers in macOS / iOS bind a concrete implementation.
public struct InertPlatformAffordances: PlatformAffordances {
    public init() {}

    @MainActor
    @discardableResult
    public func openURL(_ url: URL) -> Bool { false }

    @MainActor
    public func pickProjectDirectory() async -> URL? { nil }

    @MainActor
    public func openAppSettings() {}

    public var supportsQuit: Bool { false }

    public var supportsNativeProjectPicker: Bool { false }

    @MainActor
    public func quitApp() {}
}
