import SwiftUI

// Cross-store capture surface: `CaptureExpandedContent` is mounted by
// `ComposeSection` (`OperatorSections.swift`).

/// Per-target tint reused across the success, ambiguous suggestion chip,
/// and contributor-failed badges. Knowledge / memory / tasks match
/// `RecallSourceBadge`; inbox is the only target absent from the recall
/// surface and gets its own tint so the operator can distinguish it.
func captureTargetTint(_ target: CaptureTarget) -> Color {
    switch target {
    case .knowledge: return .blue
    case .memory: return .purple
    case .tasks: return .orange
    case .inbox: return .teal
    }
}

/// Pill matching `RecallStateBadge` / `AnswerStateBadge` so the menu-bar
/// vocabulary stays consistent across sibling per-store sections.
struct CaptureStateBadge: View {
    let label: String
    let tint: Color

    var body: some View {
        Text(label)
            .font(.caption2)
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(tint.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

struct CaptureExpandedContent: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CaptureDraftField()
            CaptureControlsRow()
            CaptureBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct CaptureDraftField: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        TextField(
            "Capture a note across stores…",
            text: $appState.captureDraft,
            axis: .vertical
        )
        .textFieldStyle(.roundedBorder)
        .font(.caption)
        .lineLimit(3...6)
    }
}

/// Picker (auto + the four `CaptureTarget` arms) plus an optional hint
/// field plus a submit affordance. Submit re-issues
/// `AppState.loadCapture` only on explicit action — never on keystroke —
/// matching the task contract's "no auto-capture on keystroke" rule.
struct CaptureControlsRow: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Picker("Target", selection: $appState.captureTarget) {
                    Text("auto").tag(CaptureTargetChoice.auto)
                    ForEach(CaptureTarget.allCases, id: \.self) { t in
                        Text(t.rawValue).tag(CaptureTargetChoice.target(t))
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .font(.caption)

                TextField("hint (optional)", text: $appState.captureHint)
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)

                Button(action: { Task { await appState.loadCapture() } }) {
                    if appState.isLoadingCapture {
                        ProgressView().scaleEffect(0.5)
                    } else {
                        Text("Capture").font(.caption)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(appState.isLoadingCapture || isSubmitDisabled)
            }
        }
    }

    private var isSubmitDisabled: Bool {
        appState.captureDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Tagged choice for the picker: `.auto` maps to `nil` target on the
/// daemon (the classifier picks); the four `.target` arms map one-to-one.
/// Modeled as a discriminated enum rather than `CaptureTarget?` so the
/// SwiftUI `Picker` can tag it without optional-binding gymnastics.
enum CaptureTargetChoice: Hashable {
    case auto
    case target(CaptureTarget)

    var resolved: CaptureTarget? {
        switch self {
        case .auto: return nil
        case .target(let t): return t
        }
    }
}

struct CaptureBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.captureError {
                CaptureErrorView(message: err)
            } else if appState.isLoadingCapture && appState.captureResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Capturing…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredDraft {
                Text("Type a note. Pick a store or leave on auto, then submit.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.captureResult {
                CaptureResultView(result: result)
            } else {
                Text("Press Capture to route this note.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasEnteredDraft: Bool {
        !appState.captureDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Renders one of the four `CaptureResult` arms. The textual body comes
/// from `renderCaptureResultPlain` verbatim — the helper already encodes
/// every arm's line shape (`Captured: <target>  <recordId>[  <path>]`,
/// `Ambiguous capture. Re-run with --target …`, the no-contributors
/// notice, and `Capture into <target> failed: <message>`). SwiftUI
/// layers a per-target badge on top of the success and contributor-failed
/// arms and a suggestion chip row on top of the ambiguous arm so the
/// operator can scan attribution without parsing text.
struct CaptureResultView: View {
    let result: CaptureResult

    var body: some View {
        switch result {
        case .success(let record):
            CaptureSuccessRow(record: record)
        case .ambiguous(let suggestions):
            CaptureAmbiguousRow(suggestions: suggestions)
        case .noContributors:
            CaptureNoticeRow(text: renderCaptureResultPlain(result))
        case .contributorFailed(let target, _):
            CaptureFailedRow(target: target, text: renderCaptureResultPlain(result))
        }
    }
}

struct CaptureSuccessRow: View {
    let record: CaptureRecord

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            CaptureStateBadge(label: record.target.rawValue, tint: captureTargetTint(record.target))
            Text(renderCaptureResultPlain(.success(record: record)))
                .font(.system(.caption, design: .monospaced))
                .lineLimit(3)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

struct CaptureAmbiguousRow: View {
    let suggestions: [CaptureTarget]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(renderCaptureResultPlain(.ambiguous(suggestions: suggestions)))
                .font(.caption)
                .foregroundStyle(.orange)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 4) {
                ForEach(suggestions, id: \.self) { suggestion in
                    CaptureStateBadge(label: suggestion.rawValue, tint: captureTargetTint(suggestion))
                }
            }
            Text("Pick a store from the picker above and resubmit.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

struct CaptureNoticeRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct CaptureFailedRow: View {
    let target: CaptureTarget
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            CaptureStateBadge(label: target.rawValue, tint: captureTargetTint(target))
            Text(text)
                .font(.caption)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }
}

struct CaptureErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadCapture() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingCapture)
        }
    }
}
