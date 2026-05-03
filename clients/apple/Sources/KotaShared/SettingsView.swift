import SwiftUI

/// Status icon + pending-approvals badge rendered inside the macOS
/// `MenuBarExtra` label. Lives in the shared module so the iOS shell
/// can render the same visual identifier (e.g. as a navigation-bar
/// status icon) without duplicating the icon/color logic. Takes the
/// shared `AppState` directly so callers in the platform shells do
/// not have to thread `DaemonHealth` / `pendingApprovals.count`
/// through public accessors.
public struct MenuBarLabel: View {
    @ObservedObject var appState: AppState

    public init(appState: AppState) {
        self.appState = appState
    }

    public var body: some View {
        HStack(spacing: 3) {
            Image(systemName: appState.health.systemImageName)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(iconColor)
            if appState.pendingApprovals.count > 0 {
                Text("\(appState.pendingApprovals.count)")
                    .font(.caption2.bold())
                    .foregroundStyle(.red)
            }
        }
    }

    var iconColor: Color {
        switch appState.health {
        case .idle: return .green
        case .running: return .orange
        case .error: return .red
        default: return .secondary
        }
    }
}

/// Shared settings form. Both the macOS Settings scene and the iOS
/// settings tab mount this directly so project-directory and remote-
/// daemon configuration stays one shape across platforms. The
/// "Choose…" project-directory button delegates to the platform
/// affordance: macOS shows an `NSOpenPanel`; iOS surfaces a manual
/// path-entry sheet because the iOS sandbox cannot grant
/// arbitrary-folder access.
public struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @State private var webUIPort: String = {
        let p = UserDefaults.standard.integer(forKey: "webUIPort")
        return p > 0 ? String(p) : "3000"
    }()
    @State private var remoteURLField: String = ""
    @State private var remoteTokenField: String = ""
    @State private var manualProjectPath: String = ""

    public init() {}

    public var body: some View {
        Form {
            Section("Project") {
                HStack {
                    Text(appState.projectDir?.path ?? "Not configured")
                        .truncationMode(.head)
                        .foregroundStyle(appState.projectDir == nil ? .red : .primary)
                    Spacer()
                    if appState.platform.supportsNativeProjectPicker {
                        Button("Choose…") {
                            Task { await appState.promptForProjectDirectory() }
                        }
                    }
                }

                if !appState.platform.supportsNativeProjectPicker {
                    // iOS path: NSOpenPanel doesn't exist; the operator
                    // types the project path manually and we resolve it
                    // through the same `projectDir` write that the macOS
                    // chooser uses.
                    HStack {
                        TextField("/path/to/project", text: $manualProjectPath)
                            .textFieldStyle(.roundedBorder)
                        Button("Set") {
                            let trimmed = manualProjectPath.trimmingCharacters(in: .whitespacesAndNewlines)
                            if !trimmed.isEmpty {
                                appState.projectDir = URL(fileURLWithPath: trimmed)
                                appState.startPolling()
                            }
                        }
                        .disabled(manualProjectPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
        manualProjectPath = appState.projectDir?.path ?? ""
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
