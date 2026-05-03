import Foundation

// Owner-question entries surfaced by the daemon's `/owner-questions`
// routes.

struct OwnerQuestionsResponse: Codable {
    let questions: [OwnerQuestion]
}

struct OwnerQuestion: Codable, Identifiable {
    let id: String
    let context: String
    let question: String
    let reason: String
    let source: String
    let createdAt: String
    let status: String
    let proposedAnswers: [String]?
}
