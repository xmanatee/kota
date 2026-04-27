import SwiftUI

/// Menu-bar surface for the daemon's cited-answer seam. Mirrors the
/// `kota answer`, daemon `POST /answer`, Telegram `/answer`, and web
/// `AnswerPanel` consumers — one shared seam, one synthesized answer
/// plus typed citations across surfaces. The view binds to
/// `AppState.answer*` observables and uses `DaemonClient.answer` through
/// the same wrapper every other section uses; per-citation rows resolve
/// against the typed `RecallHit` payload by `{ source, id }` (the same
/// key `renderAnswerCitationsPlain` reads), and per-source tints come
/// from `RecallSourceBadge` so the cited-answer column stays visually
/// consistent with `RecallView`.
struct AnswerView: View {
    @EnvironmentObject var appState: AppState
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
            Button(action: { isExpanded.toggle() }) {
                HStack {
                    Image(systemName: "text.bubble")
                        .imageScale(.small)
                        .foregroundStyle(headerIconColor)
                    Text("Answer")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let badge = headerBadge {
                        AnswerStateBadge(label: badge.label, isActive: badge.isActive)
                    }
                    Spacer()
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .imageScale(.small)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                AnswerExpandedContent()
            }
        }
    }

    private var headerIconColor: Color {
        guard let result = appState.answerResult else { return .secondary }
        switch result {
        case .success: return .blue
        case .noHits, .semanticUnavailable, .synthesisFailed:
            return .orange
        }
    }

    private var headerBadge: (label: String, isActive: Bool)? {
        guard let result = appState.answerResult else { return nil }
        switch result {
        case .success(_, let citations, _):
            if citations.isEmpty { return ("answered", true) }
            return (citations.count == 1 ? "1 cite" : "\(citations.count) cites", true)
        case .noHits: return ("no hits", false)
        case .semanticUnavailable: return ("recall unavailable", false)
        case .synthesisFailed: return ("synthesis failed", false)
        }
    }
}

/// Active-vs-inactive label, driven by the typed `AnswerResult` branch —
/// never inferred from the rendered text body. Mirrors `RecallStateBadge`
/// one-to-one so the macOS surface speaks the same vocabulary across
/// sibling per-store sections.
struct AnswerStateBadge: View {
    let label: String
    let isActive: Bool

    var body: some View {
        Text(label)
            .font(.caption2)
            .foregroundStyle(isActive ? Color.blue : Color.secondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background((isActive ? Color.blue : Color.secondary).opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }
}

struct AnswerExpandedContent: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AnswerQueryField()
            AnswerBodyView()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.07))
    }
}

struct AnswerQueryField: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass")
                .imageScale(.small)
                .foregroundStyle(.secondary)
            TextField("Ask the second brain…", text: $appState.answerQuery)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .onSubmit { Task { await appState.loadAnswer() } }
            if appState.isLoadingAnswer {
                ProgressView().scaleEffect(0.5)
            }
        }
    }
}

struct AnswerBodyView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let err = appState.answerError {
                AnswerErrorView(message: err)
            } else if appState.isLoadingAnswer && appState.answerResult == nil {
                HStack(spacing: 4) {
                    ProgressView().scaleEffect(0.6)
                    Text("Composing…")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if !hasEnteredQuery {
                Text("Type a question to ask across knowledge, memory, history, and tasks.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let result = appState.answerResult {
                AnswerResultView(result: result)
            } else {
                Text("Press return to ask.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasEnteredQuery: Bool {
        !appState.answerQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

/// Renders one of the four `AnswerResult` arms. The synthesized-success
/// arm prints the composed prose verbatim (preserving the inline
/// `[source:id]` markers the daemon emits) followed by a per-citation
/// list. The three `ok: false` arms degrade to the same operator-facing
/// notice copy the web `AnswerPanel` and Telegram `/answer` reply use,
/// so every surface speaks the same vocabulary.
struct AnswerResultView: View {
    let result: AnswerResult

    var body: some View {
        switch result {
        case .success(let answer, let citations, let hits):
            AnswerSuccessView(answer: answer, citations: citations, hits: hits)
        case .noHits:
            AnswerNoticeView(message: "No matching sources for this question.")
        case .semanticUnavailable:
            AnswerNoticeView(message: "Answer unavailable — no recall contributors registered.")
        case .synthesisFailed:
            AnswerNoticeView(message: "Could not compose a cited answer for this question.")
        }
    }
}

struct AnswerNoticeView: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.caption)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The synthesized-success arm: one composed answer body verbatim, plus
/// a per-citation list resolved against the typed `RecallHit` payload by
/// `{ source, id }` — exactly the key `renderAnswerCitationsPlain` reads.
/// Unresolved citations are dropped (mirroring the shared helper) so the
/// view never paints a hallucinated row.
struct AnswerSuccessView: View {
    let answer: String
    let citations: [AnswerCitation]
    let hits: [RecallHit]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(answer)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if !citationRows.isEmpty {
                Divider()
                AnswerCitationsList(rows: citationRows)
            }
        }
    }

    private var citationRows: [RecallHit] {
        var byKey: [String: RecallHit] = [:]
        for hit in hits {
            byKey["\(hit.source):\(hit.id)"] = hit
        }
        return citations.compactMap { byKey["\($0.source):\($0.id)"] }
    }
}

struct AnswerCitationsList: View {
    let rows: [RecallHit]

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, hit in
                AnswerCitationRow(hit: hit)
            }
        }
    }
}

/// Per-citation row tinted by `RecallSourceBadge` — the same source-tint
/// mapping the recall surface uses (`knowledge`→blue, `memory`→purple,
/// `history`→green, `tasks`→orange). Color drives the source column
/// directly so the operator can scan attribution without parsing text.
struct AnswerCitationRow: View {
    let hit: RecallHit

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            RecallSourceBadge(source: hit.source)
            Text(String(format: "%.3f", hit.score))
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            Text(hit.describe)
                .font(.caption)
                .lineLimit(2)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

struct AnswerErrorView: View {
    @EnvironmentObject var appState: AppState
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(message)
                .font(.caption2)
                .foregroundStyle(.red)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: { Task { await appState.loadAnswer() } }) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .font(.caption2)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(appState.isLoadingAnswer)
        }
    }
}
