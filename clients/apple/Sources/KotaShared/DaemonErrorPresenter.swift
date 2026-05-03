import Foundation

/// Single helper that turns errors raised by `DaemonClient` (or by Foundation
/// wrappers around it) into the operator-facing strings that view models and
/// SwiftUI views display. Using this helper instead of
/// `error.localizedDescription` everywhere ensures HTTP error bodies and
/// `notConnected` cases render with the same vocabulary across the menu bar.
enum DaemonErrorPresenter {
    /// One-line summary of any error raised by daemon work. For
    /// `DaemonClientError`, uses the typed `LocalizedError` description (which
    /// includes decoded HTTP error bodies). For other errors, falls back to
    /// `localizedDescription` so URL-loading / cancellation messages still
    /// surface honestly.
    static func message(for error: Error) -> String {
        if let daemonError = error as? DaemonClientError {
            return daemonError.localizedDescription
        }
        return error.localizedDescription
    }
}
