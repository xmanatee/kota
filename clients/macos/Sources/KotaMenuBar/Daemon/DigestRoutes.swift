import Foundation

extension DaemonClient {
    func fetchDigest() async throws -> DigestResponse {
        try await get("/api/digest")
    }
}
