import SwiftUI

// Cross-store retract surface: `RetractExpandedContent` is mounted by
// `ComposeSection` (`OperatorSections.swift`).

/// Per-target tint reused by every retract badge. Knowledge / memory /
/// tasks match `captureTargetTint`; inbox uses `teal` (introduced for
/// `CaptureView`).
func retractTargetTint(_ target: RetractTarget) -> Color {
    switch target {
    case .knowledge: return .blue
    case .memory: return .purple
    case .tasks: return .orange
    case .inbox: return .teal
    }
}

/// Per-target identifier label for the SwiftUI input. Mirrors
/// `RetractPanel.tsx`. Exhaustive over `RetractTarget`.
func retractIdentifierLabel(for target: RetractTarget) -> String {
    switch target {
    case .memory: return "id"
    case .knowledge: return "slug"
    case .tasks: return "id"
    case .inbox: return "path"
    }
}

/// Per-target placeholder mirroring `RetractPanel.tsx`.
func retractIdentifierPlaceholder(for target: RetractTarget) -> String {
    switch target {
    case .memory: return "memory id (e.g. mem-7)"
    case .knowledge: return "knowledge slug"
    case .tasks: return "task id (filename without .md)"
    case .inbox: return "data/inbox/note-foo.md"
    }
}

/// Builds the typed `RetractRequest` arm matching the picker's target.
func buildRetractRequest(target: RetractTarget, identifier: String) -> RetractRequest {
    switch target {
    case .memory: return .memory(id: identifier)
    case .knowledge: return .knowledge(slug: identifier)
    case .tasks: return .tasks(id: identifier)
    case .inbox: return .inbox(path: identifier)
    }
}

/// Pure outcome of a retract submit attempt. Encodes the two-submit gate
/// so it is unit-testable without instantiating `AppState` (whose `init`
/// reaches into `UNUserNotificationCenter.current()`).
enum RetractSubmitOutcome: Equatable {
    case skip
    case requireConfirmation
    case fire(RetractRequest)
}

func evaluateRetractSubmit(
    target: RetractTarget,
    identifier: String,
    confirmed: Bool
) -> RetractSubmitOutcome {
    let trimmed = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return .skip }
    if !confirmed { return .requireConfirmation }
    return .fire(buildRetractRequest(target: target, identifier: trimmed))
}

struct RetractExpandedContent: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RetractControlsRow()
            RetractBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

/// Picker + target-aware identifier field + confirm/submit affordance.
/// First submit flips to "Confirm retract" + Cancel; second submit fires.
/// Mirrors the dashboard `RetractPanel.tsx` gate against the seam's
/// `dangerous` risk classification. Target / identifier edits invalidate
/// the confirmation through `AppState`'s `didSet` observers.
struct RetractControlsRow: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Picker("Target", selection: $appState.retractTarget) {
                    ForEach(RetractTarget.allCases, id: \.self) { t in
                        Text(t.rawValue).tag(t)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .font(.caption)
                .frame(width: 92)

                TextField(
                    retractIdentifierPlaceholder(for: appState.retractTarget),
                    text: $appState.retractIdentifier
                )
                .textFieldStyle(.roundedBorder)
                .font(.caption)
            }

            HStack(spacing: 4) {
                Text(retractIdentifierLabel(for: appState.retractTarget))
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Spacer()

                if appState.retractConfirmed {
                    Button(action: { appState.retractConfirmed = false }) {
                        Text("Cancel").font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(appState.isLoadingRetract)
                }

                Button(action: { Task { await appState.loadRetract() } }) {
                    if appState.isLoadingRetract {
                        ProgressView().scaleEffect(0.5)
                    } else {
                        Text(appState.retractConfirmed ? "Confirm retract" : "Retract")
                            .font(.caption)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .tint(appState.retractConfirmed ? .red : .accentColor)
                .disabled(appState.isLoadingRetract || isSubmitDisabled)
            }
        }
    }

    private var isSubmitDisabled: Bool {
        appState.retractIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct RetractBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.retractError {
                RetractErrorView(message: err)
            } else if appState.isLoadingRetract && appState.retractResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Retracting…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredIdentifier {
                Text("Pick a store, type the \(retractIdentifierLabel(for: appState.retractTarget)), then submit.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.retractResult {
                RetractResultView(result: result)
            } else if appState.retractConfirmed {
                Text("Press Confirm retract to remove this record. This is destructive.")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Press Retract to remove this record.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasEnteredIdentifier: Bool {
        !appState.retractIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Renders one of the four `RetractResult` arms. Body text comes from
/// `renderRetractResultPlain` verbatim; SwiftUI adds the per-target badge.
struct RetractResultView: View {
    let result: RetractResult

    var body: some View {
        switch result {
        case .success(let record):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                CaptureStateBadge(label: record.target.rawValue, tint: retractTargetTint(record.target))
                Text(renderRetractResultPlain(result))
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(3)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        case .noContributors:
            Text(renderRetractResultPlain(result))
                .font(.caption)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
        case .notFound(let target, _):
            RetractTargetedRow(target: target, text: renderRetractResultPlain(result), tint: .orange)
        case .contributorFailed(let target, _):
            RetractTargetedRow(target: target, text: renderRetractResultPlain(result), tint: .red)
        }
    }
}

/// Shared row for the not-found (orange) and contributor-failed (red)
/// arms — only the foreground tint differs.
struct RetractTargetedRow: View {
    let target: RetractTarget
    let text: String
    let tint: Color

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            CaptureStateBadge(label: target.rawValue, tint: retractTargetTint(target))
            Text(text)
                .font(.caption)
                .foregroundStyle(tint)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }
}

struct RetractErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadRetract() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingRetract)
        }
    }
}
