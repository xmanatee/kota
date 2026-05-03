import XCTest
@testable import KotaShared

/// Coverage for the operator-first IA's view-model surface — the bits
/// SwiftUI bodies and tests both consume:
///
/// - `AttentionInboxSummary` derives the `Respond` group's badge,
///   tint, and "non-empty" predicate from a typed `(approvals,
///   ownerQuestions, failedRuns)` tuple. The popover's auto-expand and
///   header tint must follow the priority "approvals/owner questions
///   are blocking → red; failed runs alone are concerning → orange;
///   empty queue → muted secondary".
///
/// - `AskMode` enumerates the six search arms the unified Ask surface
///   covers. The picker order, label vocabulary, and per-mode
///   placeholder need to match the previous per-store sections so the
///   operator does not relearn vocabulary.
///
/// `AppState` is intentionally not constructed here — its `init` reaches
/// into `UNUserNotificationCenter.current()`, which crashes outside an
/// `.app` bundle. Every behavior the SwiftUI body folds into the
/// header/badge/tint pulls from the pure helpers below.
final class OperatorSectionsTests: XCTestCase {

    // MARK: - AttentionInboxSummary

    func testAttentionInboxSummaryEmptyWhenAllZero() {
        let summary = attentionInboxSummary(approvals: 0, ownerQuestions: 0, failedRuns: 0)
        XCTAssertTrue(summary.isEmpty)
        XCTAssertEqual(summary.total, 0)
        XCTAssertEqual(summary.badge, "")
    }

    func testAttentionInboxSummaryDropsZeroBuckets() {
        let summary = attentionInboxSummary(approvals: 2, ownerQuestions: 0, failedRuns: 1)
        XCTAssertEqual(summary.total, 3)
        XCTAssertFalse(summary.isEmpty)
        XCTAssertEqual(summary.badge, "2 approvals · 1 failed run")
    }

    func testAttentionInboxSummarySingularPlural() {
        let one = attentionInboxSummary(approvals: 1, ownerQuestions: 1, failedRuns: 1)
        XCTAssertEqual(one.badge, "1 approval · 1 question · 1 failed run")
        let many = attentionInboxSummary(approvals: 3, ownerQuestions: 4, failedRuns: 5)
        XCTAssertEqual(many.badge, "3 approvals · 4 questions · 5 failed runs")
    }

    /// Approvals or owner questions push the header tint to red because
    /// they require an operator response to clear. This is the visible
    /// "you must look at this" cue — the previous fan-out hid them
    /// behind a wall of optional-provider errors.
    func testAttentionInboxSummaryTintFavorsBlocking() {
        XCTAssertEqual(
            attentionInboxSummary(approvals: 1, ownerQuestions: 0, failedRuns: 0).tint,
            .red
        )
        XCTAssertEqual(
            attentionInboxSummary(approvals: 0, ownerQuestions: 1, failedRuns: 0).tint,
            .red
        )
        XCTAssertEqual(
            attentionInboxSummary(approvals: 1, ownerQuestions: 1, failedRuns: 1).tint,
            .red
        )
    }

    /// A failed run alone is not blocking — the operator may want to
    /// triage it but the daemon will not stall. Mid-tier orange tint.
    func testAttentionInboxSummaryTintForFailedRunsOnly() {
        XCTAssertEqual(
            attentionInboxSummary(approvals: 0, ownerQuestions: 0, failedRuns: 1).tint,
            .orange
        )
        XCTAssertEqual(
            attentionInboxSummary(approvals: 0, ownerQuestions: 0, failedRuns: 7).tint,
            .orange
        )
    }

    func testAttentionInboxSummaryTintEmpty() {
        XCTAssertEqual(
            attentionInboxSummary(approvals: 0, ownerQuestions: 0, failedRuns: 0).tint,
            .secondary
        )
    }

    // MARK: - AskMode

    /// Picker order is load-bearing: the operator picks `ask` (cited
    /// synthesis) by default, then `recall` (cross-store ranked hits),
    /// then the four per-store search arms. Pinning this here keeps the
    /// SwiftUI picker's `ForEach(AskMode.allCases)` lockstep with the
    /// IA the task contract describes.
    func testAskModeAllCasesOrdered() {
        XCTAssertEqual(
            AskMode.allCases,
            [.ask, .recall, .knowledge, .memory, .history, .tasks]
        )
    }

    func testAskModeLabelMatchesPickerVocabulary() {
        XCTAssertEqual(AskMode.ask.label, "Ask")
        XCTAssertEqual(AskMode.recall.label, "Recall")
        XCTAssertEqual(AskMode.knowledge.label, "Knowledge")
        XCTAssertEqual(AskMode.memory.label, "Memory")
        XCTAssertEqual(AskMode.history.label, "History")
        XCTAssertEqual(AskMode.tasks.label, "Tasks")
    }

    /// The per-mode placeholder is what the operator sees inside the
    /// search field. Pinning the strings keeps the unified surface in
    /// vocabulary lockstep with the per-store views the IA replaces
    /// (Knowledge / Memory / History / Tasks placeholders are verbatim
    /// from their predecessor screens).
    func testAskModePlaceholderMatchesPredecessorScreens() {
        XCTAssertEqual(AskMode.ask.placeholder, "Ask the second brain…")
        XCTAssertEqual(AskMode.recall.placeholder, "Recall across stores…")
        XCTAssertEqual(AskMode.knowledge.placeholder, "Search knowledge…")
        XCTAssertEqual(AskMode.memory.placeholder, "Search memory…")
        XCTAssertEqual(AskMode.history.placeholder, "Search history…")
        XCTAssertEqual(AskMode.tasks.placeholder, "Search tasks…")
    }

    /// Each mode declares a stable SF Symbol so the picker can render
    /// each row with the same icon the predecessor screens used.
    func testAskModeIconsAreStable() {
        XCTAssertEqual(AskMode.ask.systemImage, "text.bubble")
        XCTAssertEqual(AskMode.recall.systemImage, "sparkle.magnifyingglass")
        XCTAssertEqual(AskMode.knowledge.systemImage, "books.vertical")
        XCTAssertEqual(AskMode.memory.systemImage, "brain")
        XCTAssertEqual(AskMode.history.systemImage, "clock.arrow.2.circlepath")
        XCTAssertEqual(AskMode.tasks.systemImage, "list.bullet.rectangle")
    }

    // MARK: - ComposeMode

    /// Capture is the default and primary action; retract is destructive
    /// and intentionally subordinate. The order pins which arm of the
    /// segmented control reads first.
    func testComposeModeAllCasesOrdered() {
        XCTAssertEqual(ComposeMode.allCases, [.capture, .retract])
        XCTAssertEqual(ComposeMode.capture.label, "Capture")
        XCTAssertEqual(ComposeMode.retract.label, "Retract")
    }
}
