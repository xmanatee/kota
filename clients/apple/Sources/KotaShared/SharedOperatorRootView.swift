import SwiftUI

public enum SharedOperatorPresentation {
    case menuBar
    case tabs
}

/// The single production inventory for macOS and iOS. The shells choose only
/// how daemon-declared intents are presented; surface order, navigation,
/// availability, forms, confirmations, and actions all come from the bundle.
public struct SharedOperatorRootView: View {
    @EnvironmentObject private var appState: AppState
    private let presentation: SharedOperatorPresentation
    @State private var selectedSurfaceId: String?
    @State private var selectedIntentRaw = ""
    @State private var chatSessionId: String?

    public init(presentation: SharedOperatorPresentation) {
        self.presentation = presentation
    }

    public var body: some View {
        Group {
            if let bundle = appState.uiSurfaceBundle {
                let inventory = SharedUiInventory(bundle: bundle)
                if inventory.surfaces.isEmpty {
                    SharedOperatorEmptyState(
                        title: "No operator surfaces",
                        detail: "No modules contribute ui.surface.v1 content for this scope."
                    )
                } else {
                    switch presentation {
                    case .menuBar:
                        menuBarContent(inventory)
                    case .tabs:
                        tabContent(inventory)
                    }
                }
            } else if appState.isLoadingUiSurfaces {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Loading shared operator surfaces…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                SharedOperatorEmptyState(
                    title: appState.uiSurfaceError == nil ? "Daemon offline" : "Shared UI unavailable",
                    detail: appState.uiSurfaceError ?? appState.diagnostic.detail,
                    action: { Task { await appState.refreshUiSurfaceBundle() } }
                )
            }
        }
        .onAppear { reconcileSelection() }
        .onChange(of: appState.uiSurfaceBundle) { _ in reconcileSelection() }
        .sheet(isPresented: Binding(
            get: { chatSessionId != nil },
            set: { if !$0 { chatSessionId = nil } }
        )) {
            if let chatSessionId {
                ChatView(sessionId: chatSessionId).environmentObject(appState)
            }
        }
        .accessibilityIdentifier("shared-operator-root")
        .task { appState.start() }
    }

    private func menuBarContent(_ inventory: SharedUiInventory) -> some View {
        VStack(spacing: 0) {
            SharedOperatorConnectionBar()
            ScopeSelectorView()
            Divider()
            Picker("Surface", selection: selectedSurfaceBinding(inventory)) {
                ForEach(inventory.intents, id: \.rawValue) { intent in
                    Section(intent.rawValue) {
                        ForEach(inventory.entries(for: intent), id: \.surface.surfaceId) { entry in
                            Label(entry.surface.title, systemImage: intent.systemImage)
                                .padding(.leading, CGFloat(entry.depth * 12))
                                .tag(entry.surface.surfaceId)
                        }
                    }
                }
            }
            .pickerStyle(.menu)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)

            Divider()
            ScrollView {
                if let selected = selectedSurface(inventory) {
                    SharedUiSurfaceView(
                        surface: selected,
                        onNavigate: selectSurface,
                        onSessionSelect: { chatSessionId = $0 }
                    )
                    .padding(12)
                }
            }
        }
    }

    private func tabContent(_ inventory: SharedUiInventory) -> some View {
        VStack(spacing: 0) {
            ScopeSelectorView()
            TabView(selection: selectedIntentBinding(inventory)) {
                ForEach(inventory.intents, id: \.rawValue) { intent in
                    NavigationStack {
                        SharedIntentSurfaceView(
                            intent: intent,
                            entries: inventory.entries(for: intent),
                            selectedSurfaceId: $selectedSurfaceId,
                            onNavigate: selectSurface,
                            onSessionSelect: { chatSessionId = $0 }
                        )
                        .navigationTitle(intent.rawValue)
                        .toolbar {
                            ToolbarItem(placement: .automatic) {
                                Button { Task { await appState.refreshUiSurfaceBundle() } } label: {
                                    Image(systemName: "arrow.clockwise")
                                }
                            }
                        }
                    }
                    .tabItem { Label(intent.rawValue, systemImage: intent.systemImage) }
                    .tag(intent.rawValue)
                }
            }
        }
    }

    private func selectedSurfaceBinding(_ inventory: SharedUiInventory) -> Binding<String> {
        Binding(
            get: { selectedSurface(inventory)?.surfaceId ?? inventory.surfaces[0].surfaceId },
            set: { selectedSurfaceId = $0 }
        )
    }

    private func selectedIntentBinding(_ inventory: SharedUiInventory) -> Binding<String> {
        Binding(
            get: {
                if inventory.intents.contains(where: { $0.rawValue == selectedIntentRaw }) {
                    return selectedIntentRaw
                }
                return inventory.intents[0].rawValue
            },
            set: { raw in
                selectedIntentRaw = raw
                if let intent = inventory.intents.first(where: { $0.rawValue == raw }),
                   let first = inventory.surfaces(for: intent).first {
                    selectedSurfaceId = first.surfaceId
                }
            }
        )
    }

    private func selectedSurface(_ inventory: SharedUiInventory) -> UiSurface? {
        inventory.surfaces.first { $0.surfaceId == selectedSurfaceId } ?? inventory.entrySurface
    }

    private func selectSurface(_ surfaceId: String) {
        guard let bundle = appState.uiSurfaceBundle,
              let surface = bundle.surfaces.first(where: { $0.surfaceId == surfaceId })
        else { return }
        selectedSurfaceId = surfaceId
        selectedIntentRaw = surface.intent.rawValue
    }

    private func reconcileSelection() {
        guard let bundle = appState.uiSurfaceBundle else {
            selectedSurfaceId = nil
            selectedIntentRaw = ""
            return
        }
        let inventory = SharedUiInventory(bundle: bundle)
        guard let first = inventory.entrySurface else { return }
        let selected = inventory.surfaces.first { $0.surfaceId == selectedSurfaceId } ?? first
        selectedSurfaceId = selected.surfaceId
        selectedIntentRaw = selected.intent.rawValue
    }
}

private struct SharedIntentSurfaceView: View {
    let intent: UiIntent
    let entries: [SharedUiSurfaceEntry]
    @Binding var selectedSurfaceId: String?
    let onNavigate: (String) -> Void
    let onSessionSelect: (String) -> Void

    var body: some View {
        let surfaces = entries.map(\.surface)
        VStack(spacing: 0) {
            if surfaces.count > 1 {
                Picker("\(intent.rawValue) surface", selection: selection) {
                    ForEach(entries, id: \.surface.surfaceId) { entry in
                        Text(entry.surface.title)
                            .padding(.leading, CGFloat(entry.depth * 12))
                            .tag(entry.surface.surfaceId)
                    }
                }
                .pickerStyle(.menu)
                .padding(.horizontal)
                Divider()
            }
            ScrollView {
                if let surface = selected {
                    SharedUiSurfaceView(
                        surface: surface,
                        onNavigate: onNavigate,
                        onSessionSelect: onSessionSelect
                    )
                    .padding()
                }
            }
        }
        .onAppear {
            if selected == nil { selectedSurfaceId = surfaces.first?.surfaceId }
        }
    }

    private var selected: UiSurface? {
        let surfaces = entries.map(\.surface)
        return surfaces.first { $0.surfaceId == selectedSurfaceId } ?? surfaces.first
    }

    private var selection: Binding<String> {
        let surfaces = entries.map(\.surface)
        return Binding(
            get: { selected?.surfaceId ?? surfaces.first?.surfaceId ?? "" },
            set: { selectedSurfaceId = $0 }
        )
    }
}

private struct SharedOperatorConnectionBar: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: appState.uiSurfaceEventsConnected ? "dot.radiowaves.left.and.right" : appState.health.systemImageName)
                .foregroundStyle(appState.uiSurfaceEventsConnected ? Color.green : Color.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(appState.diagnostic.headline).font(.caption.weight(.semibold)).lineLimit(1)
                Text(appState.uiSurfaceEventsConnected ? "Live updates connected" : "5-second refresh fallback")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button { Task { await appState.refreshUiSurfaceBundle() } } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .disabled(appState.isLoadingUiSurfaces)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

private struct SharedOperatorEmptyState: View {
    let title: String
    let detail: String
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "rectangle.3.group.bubble.left")
                .font(.title)
                .foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(detail).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            if let action { Button("Try Again", action: action).buttonStyle(.bordered) }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
