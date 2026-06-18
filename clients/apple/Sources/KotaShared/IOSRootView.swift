#if os(iOS)
import SwiftUI

/// iOS-shaped root view. Mirrors the macOS popover IA
/// (monitor / respond / ask / capture / browse / configure) but
/// expanded into a `TabView` instead of a single scrollable popover
/// because iOS has no MenuBarExtra.
///
/// Tabs:
///   1. Status    — diagnostic header + active runs
///   2. Inbox     — approvals, owner questions, blocked work, failed runs
///   3. Work      — tasks, sessions, runs, digest, attention rollup
///   4. Knowledge — search/ask plus capture/retract
///   5. Setup     — project + remote daemon configuration
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
                        ProjectSelectorView()
                        if !appState.activeRuns.isEmpty {
                            Divider()
                            OperatorSectionHeader(title: "Status")
                            ForEach(appState.activeRuns) { run in
                                ActiveRunRow(run: run)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
                .navigationTitle("Status")
            }
            .tabItem { Label("Status", systemImage: "circle.fill") }

            NavigationStack {
                ScrollView { AttentionInboxView() }
                    .navigationTitle("Inbox")
            }
            .tabItem { Label("Inbox", systemImage: "tray.full") }

            NavigationStack {
                ScrollView { WorkSection() }
                    .navigationTitle("Work")
            }
            .tabItem { Label("Work", systemImage: "briefcase") }

            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        AskUnifiedView(showHeader: false)
                        ComposeSection(showHeader: false)
                    }
                    .padding(.vertical, 8)
                }
                .navigationTitle("Knowledge")
            }
            .tabItem { Label("Knowledge", systemImage: "books.vertical") }

            NavigationStack {
                SettingsView()
                    .navigationTitle("Setup")
            }
            .tabItem { Label("Setup", systemImage: "gearshape") }
        }
        .accessibilityIdentifier("ios-root-tab-view")
    }
}
#endif
