#if os(iOS)
import SwiftUI

/// iOS-shaped root view. Mirrors the macOS popover IA
/// (monitor / respond / ask / capture / browse / configure) but
/// expanded into a `TabView` instead of a single scrollable popover
/// because iOS has no MenuBarExtra.
///
/// Tabs:
///   1. Status   — diagnostic header + active runs + attention inbox
///   2. Ask      — unified search/ask over knowledge, memory,
///                 history, tasks, recall, and cited synthesis
///   3. Capture  — capture/retract surface
///   4. Settings — project + remote daemon configuration
///
/// Lives in `KotaShared` because the iOS shell stays a thin scene
/// hosting layer (just `@main` + platform glue). Wrapped in
/// `#if os(iOS)` because `TabView`'s tab-item modifier behaves
/// differently across platforms; macOS does not consume this view.
public struct IOSRootView: View {
    @EnvironmentObject var appState: AppState

    public init() {}

    public var body: some View {
        TabView {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        StatusHeaderView()
                        if !appState.activeRuns.isEmpty {
                            Divider()
                            OperatorSectionHeader(title: "Monitor")
                            ForEach(appState.activeRuns) { run in
                                ActiveRunRow(run: run)
                            }
                        }
                        AttentionInboxView()
                    }
                    .padding(.vertical, 8)
                }
                .navigationTitle("Status")
            }
            .tabItem { Label("Status", systemImage: "circle.fill") }

            NavigationStack {
                ScrollView { AskUnifiedView() }
                    .navigationTitle("Ask")
            }
            .tabItem { Label("Ask", systemImage: "magnifyingglass") }

            NavigationStack {
                ScrollView { ComposeSection() }
                    .navigationTitle("Capture")
            }
            .tabItem { Label("Capture", systemImage: "tray.and.arrow.down") }

            NavigationStack {
                SettingsView()
                    .navigationTitle("Settings")
            }
            .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .accessibilityIdentifier("ios-root-tab-view")
    }
}
#endif
