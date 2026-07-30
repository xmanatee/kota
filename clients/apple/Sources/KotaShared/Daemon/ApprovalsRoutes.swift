import Foundation

extension DaemonClient {
    func fetchApprovals() async throws -> ApprovalsResponse {
        try await get("/approvals")
    }

    func approve(id: String, reviewDigest: String) async throws {
        let body = try JSONEncoder().encode(["reviewDigest": reviewDigest])
        try await post("/approvals/\(id)/approve", body: body)
    }

    func reject(id: String) async throws {
        try await post("/approvals/\(id)/reject", body: nil as Data?)
    }
}
