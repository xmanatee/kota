import SwiftUI

struct MenuBarView: View {
    @EnvironmentObject var appState: AppState
    @State private var showTriggerSheet = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Status header
            StatusHeaderView()

            // Active runs
            if !appState.activeRuns.isEmpty {
                Divider()
                Text("Active Runs")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                ForEach(appState.activeRuns) { run in
                    ActiveRunRow(run: run)
                }
            }

            // Pending approvals
            ApprovalsView()

            // Footer actions
            Divider().padding(.top, 4)

            VStack(spacing: 0) {
                MenuActionButton(label: "Refresh", icon: "arrow.clockwise") {
                    Task { await appState.refresh() }
                }

                MenuActionButton(label: "Trigger Workflow…", icon: "play.circle") {
                    showTriggerSheet = true
                }

                MenuActionButton(label: "Open Dashboard", icon: "safari") {
                    appState.openDashboard()
                }

                MenuActionButton(label: "Set Project Directory…", icon: "folder") {
                    appState.promptForProjectDirectory()
                }

                Divider()

                MenuActionButton(label: "Quit KOTA Menu Bar", icon: "xmark.circle") {
                    NSApplication.shared.terminate(nil)
                }
            }
            .padding(.bottom, 4)
        }
        .frame(width: 280)
        .sheet(isPresented: $showTriggerSheet) {
            TriggerWorkflowView()
                .environmentObject(appState)
        }
    }
}

struct StatusHeaderView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: appState.health.systemImageName)
                .foregroundStyle(healthColor)
                .imageScale(.medium)

            VStack(alignment: .leading, spacing: 1) {
                Text("KOTA")
                    .font(.headline)
                Text(appState.health.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if appState.projectDir == nil {
                Text("No project")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    var healthColor: Color {
        switch appState.health {
        case .idle: return .green
        case .running: return .orange
        case .error: return .red
        case .offline, .unknown: return .secondary
        }
    }
}

struct ActiveRunRow: View {
    let run: ActiveRun

    var body: some View {
        HStack {
            Image(systemName: "arrow.2.circlepath")
                .imageScale(.small)
                .foregroundStyle(.orange)
            Text(run.workflow)
                .font(.system(.body, design: .monospaced))
                .fontWeight(.medium)
            Spacer()
            Text(run.elapsedDescription)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }
}

struct MenuActionButton: View {
    let label: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(label, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.clear)
    }
}
