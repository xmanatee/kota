import SwiftUI

@main
struct KotaMenuBarApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        MenuBarExtra {
            MenuBarView()
                .environmentObject(appState)
        } label: {
            MenuBarLabel(health: appState.health, pendingApprovals: appState.pendingApprovals.count)
        }
        .menuBarExtraStyle(.window)

        Settings {
            SettingsView()
                .environmentObject(appState)
        }
    }
}

struct MenuBarLabel: View {
    let health: DaemonHealth
    let pendingApprovals: Int

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: health.systemImageName)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(iconColor)
            if pendingApprovals > 0 {
                Text("\(pendingApprovals)")
                    .font(.caption2.bold())
                    .foregroundStyle(.red)
            }
        }
    }

    var iconColor: Color {
        switch health {
        case .idle: return .green
        case .running: return .orange
        case .error: return .red
        default: return .secondary
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var webUIPort: String = {
        let p = UserDefaults.standard.integer(forKey: "webUIPort")
        return p > 0 ? String(p) : "3000"
    }()
    @State private var remoteURLField: String = ""
    @State private var remoteTokenField: String = ""

    var body: some View {
        Form {
            Section("Project") {
                HStack {
                    Text(appState.projectDir?.path ?? "Not configured")
                        .truncationMode(.head)
                        .foregroundStyle(appState.projectDir == nil ? .red : .primary)
                    Spacer()
                    Button("Choose…") {
                        appState.promptForProjectDirectory()
                    }
                }
            }

            Section("Web UI") {
                HStack {
                    Text("Port")
                    Spacer()
                    TextField("3000", text: $webUIPort)
                        .frame(width: 60)
                        .multilineTextAlignment(.trailing)
                        .onSubmit { savePort() }
                }
            }

            Section {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("http://host:port", text: $remoteURLField)
                        .textFieldStyle(.roundedBorder)

                    SecureField("Auth token", text: $remoteTokenField)
                        .textFieldStyle(.roundedBorder)

                    HStack {
                        Button("Save") { saveRemote() }
                            .disabled(remoteURLField.isEmpty)

                        if !appState.remoteURL.isEmpty {
                            Button("Clear", role: .destructive) { clearRemote() }
                        }

                        Spacer()

                        if !appState.remoteURL.isEmpty {
                            Label("Remote", systemImage: "network")
                                .font(.caption)
                                .foregroundStyle(.blue)
                        }
                    }
                }
            } header: {
                Text("Remote Daemon")
            } footer: {
                Text("When configured, the remote URL takes precedence over local project-directory discovery. The token is stored in Keychain.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 420)
        .padding()
        .onAppear { loadRemoteFields() }
    }

    private func savePort() {
        if let port = Int(webUIPort), port > 0 {
            UserDefaults.standard.set(port, forKey: "webUIPort")
        }
    }

    private func loadRemoteFields() {
        remoteURLField = appState.remoteURL
        remoteTokenField = appState.loadRemoteToken()
    }

    private func saveRemote() {
        appState.saveRemoteConfig(url: remoteURLField, token: remoteTokenField)
    }

    private func clearRemote() {
        appState.clearRemoteConfig()
        remoteURLField = ""
        remoteTokenField = ""
    }
}
