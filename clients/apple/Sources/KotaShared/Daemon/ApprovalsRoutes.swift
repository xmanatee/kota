import Foundation

extension DaemonClient {
    func fetchApprovals() async throws -> ApprovalsResponse {
        try await get("/approvals")
    }
}
