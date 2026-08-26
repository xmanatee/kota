import Foundation

extension DaemonClient {
    func deleteSession(id: String, projectId: String? = nil) async throws {
        try await delete(Self.withProject("/sessions/\(id)", projectId: projectId))
    }
}
