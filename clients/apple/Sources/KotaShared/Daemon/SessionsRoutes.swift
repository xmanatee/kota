import Foundation

extension DaemonClient {
    func fetchSessions(projectId: String? = nil) async throws -> SessionsResponse {
        try await get(Self.withProject("/sessions", projectId: projectId))
    }

    func createSession(autonomyMode: AutonomyMode? = nil, projectId: String? = nil) async throws -> String {
        let body = try JSONEncoder().encode(CreateSessionRequest(autonomy_mode: autonomyMode))
        let resp: CreateSessionResponse = try await post(Self.withProject("/sessions", projectId: projectId), body: body)
        return resp.session_id
    }

    func deleteSession(id: String, projectId: String? = nil) async throws {
        try await delete(Self.withProject("/sessions/\(id)", projectId: projectId))
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode, projectId: String? = nil) async throws -> SetAutonomyModeResponse {
        let body = try JSONEncoder().encode(SetAutonomyModeRequest(autonomy_mode: mode))
        return try await patch(Self.withProject("/sessions/\(id)", projectId: projectId), body: body)
    }
}
