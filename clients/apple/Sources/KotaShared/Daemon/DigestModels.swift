import Foundation

// Mirror of `DailyDigestData` exported by the daemon's
// `src/modules/autonomy/workflows/daily-digest/aggregate.ts`. Decoding
// is strict against the daemon's contract so a payload drift fails
// loudly at `JSONDecoder` rather than silently rendering an empty
// section.

struct DigestResponse: Codable {
    let data: DailyDigestData
    let text: String
}

struct DailyDigestData: Codable {
    let windowStartedAt: String
    let windowEndedAt: String
    let builderCommits: [DigestBuilderCommitItem]
    let explorerAdditions: [DigestExplorerAdditionItem]
    let decomposerSplits: [DigestDecomposerSplitItem]
    let blockedPromoterMoves: [DigestBlockedPromoterMoveItem]
    let failedMonitoredRuns: [DigestFailedRunItem]
    let pendingOwnerQuestions: [DigestPendingOwnerQuestionItem]
    let agingOperatorCaptures: [DigestAgingOperatorCaptureItem]
    let queueDelta: DigestQueueDelta
    let quiet: Bool
}

struct DigestBuilderCommitItem: Codable {
    let runId: String
    let taskId: String?
    let taskTitle: String?
    let commitSubject: String
    let durationMs: Double?
}

struct DigestExplorerAdditionItem: Codable {
    let runId: String
    let taskCount: Int
    let watchlistAdds: Int
}

struct DigestDecomposerSplitItem: Codable {
    let runId: String
    let parentTaskId: String?
    let childTaskCount: Int
}

struct DigestBlockedPromoterMoveItem: Codable {
    let runId: String
    let promotedTaskIds: [String]
    let toReady: [String]
    let toBacklog: [String]
}

struct DigestFailedRunItem: Codable {
    let runId: String
    let workflow: String
    let status: String
    let startedAt: String
}

struct DigestPendingOwnerQuestionItem: Codable {
    let id: String
    let question: String
    let source: String
    let ageDays: Int
}

struct DigestAgingOperatorCaptureItem: Codable {
    let taskId: String
    let ageDays: Int
    let path: String
}

struct DigestQueueCounts: Codable {
    let backlog: Int
    let ready: Int
    let doing: Int
    let blocked: Int
}

struct DigestQueueCountDelta: Codable {
    let backlog: Int?
    let ready: Int?
    let doing: Int?
    let blocked: Int?
}

struct DigestQueueDelta: Codable {
    let current: DigestQueueCounts
    let previous: DigestQueueCounts?
    let delta: DigestQueueCountDelta
}
