import Foundation

extension DaemonClient {
    func deleteSession(id: String, scopeId: String? = nil) async throws {
        try await delete(Self.withScope("/sessions/\(id)", scopeId: scopeId))
    }
}
