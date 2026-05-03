import Foundation

extension DaemonClient {
    func fetchApprovals() async throws -> ApprovalsResponse {
        try await get("/approvals")
    }

    func approve(id: String) async throws {
        try await post("/approvals/\(id)/approve", body: nil as Data?)
    }

    func reject(id: String) async throws {
        try await post("/approvals/\(id)/reject", body: nil as Data?)
    }
}
