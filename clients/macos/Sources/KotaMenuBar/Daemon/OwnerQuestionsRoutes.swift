import Foundation

extension DaemonClient {
    func fetchOwnerQuestions() async throws -> OwnerQuestionsResponse {
        try await get("/owner-questions")
    }

    func answerOwnerQuestion(id: String, answer: String) async throws {
        let body = try JSONEncoder().encode(["answer": answer])
        try await post("/owner-questions/\(id)/answer", body: body)
    }

    func dismissOwnerQuestion(id: String, reason: String?) async throws {
        let body: Data?
        if let reason = reason {
            body = try JSONEncoder().encode(["reason": reason])
        } else {
            body = nil
        }
        try await post("/owner-questions/\(id)/dismiss", body: body)
    }
}
