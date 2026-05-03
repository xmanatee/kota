import Foundation

extension DaemonClient {
    func fetchAttention() async throws -> AttentionResponse {
        try await get("/api/attention")
    }
}
