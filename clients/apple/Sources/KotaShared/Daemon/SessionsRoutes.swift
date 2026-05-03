import Foundation

extension DaemonClient {
    func fetchSessions() async throws -> SessionsResponse {
        try await get("/sessions")
    }

    func createSession(autonomyMode: AutonomyMode? = nil) async throws -> String {
        let body = try JSONEncoder().encode(CreateSessionRequest(autonomy_mode: autonomyMode))
        let resp: CreateSessionResponse = try await post("/sessions", body: body)
        return resp.session_id
    }

    func deleteSession(id: String) async throws {
        try await delete("/sessions/\(id)")
    }

    func setSessionAutonomyMode(id: String, mode: AutonomyMode) async throws -> SetAutonomyModeResponse {
        let body = try JSONEncoder().encode(SetAutonomyModeRequest(autonomy_mode: mode))
        return try await patch("/sessions/\(id)", body: body)
    }
}
