import Foundation

extension DaemonClient {
    func fetchTasks() async throws -> TaskQueueResponse {
        try await get("/tasks")
    }
}
