import Foundation

extension DaemonClient {
    func fetchOwnerQuestions() async throws -> OwnerQuestionsResponse {
        try await get("/owner-questions")
    }
}
