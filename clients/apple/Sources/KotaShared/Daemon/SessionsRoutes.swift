import Foundation

extension DaemonClient {
    func fetchSessions(scopeId: String? = nil) async throws -> SessionsResponse {
        try await get(Self.withScope("/sessions", scopeId: scopeId))
    }

    func createSession(autonomyMode: AutonomyMode? = nil, scopeId: String? = nil) async throws -> String {
        let body = try JSONEncoder().encode(CreateSessionRequest(autonomy_mode: autonomyMode))
        let resp: CreateSessionResponse = try await post(Self.withScope("/sessions", scopeId: scopeId), body: body)
        return resp.session_id
    }

    func deleteSession(id: String, scopeId: String? = nil) async throws {
        try await delete(Self.withScope("/sessions/\(id)", scopeId: scopeId))
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode, scopeId: String? = nil) async throws -> SetAutonomyModeResponse {
        let body = try JSONEncoder().encode(SetAutonomyModeRequest(autonomy_mode: mode))
        return try await patch(Self.withScope("/sessions/\(id)", scopeId: scopeId), body: body)
    }
}
