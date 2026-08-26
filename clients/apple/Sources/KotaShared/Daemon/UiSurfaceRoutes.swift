import Foundation

extension DaemonClient {
    func fetchUiSurfaceBundle(scopeId: String? = nil) async throws -> UiSurfaceBundle {
        try await get(Self.withScope("/ui/surfaces", scopeId: scopeId))
    }

    func executeUiAction(
        _ action: UiAction,
        parameters: [String: UiJsonValue]? = nil
    ) async throws -> UiActionExecutionResult {
        let body = try JSONEncoder().encode(UiActionExecuteRequest(
            surfaceId: action.surfaceId,
            actionId: action.actionId,
            scopeId: action.scopeId,
            parameters: parameters
        ))
        return try await post("/ui/actions/execute", body: body)
    }

    func absoluteUiURL(path: String) -> URL? {
        guard let connection else { return nil }
        return URL(string: path, relativeTo: connection.baseURL)?.absoluteURL
    }

    /// Watches the daemon's shared SSE stream and forwards only event types
    /// declared by the current surface bundle. The periodic AppState refresh
    /// remains the reconnect fallback; this stream supplies protocol-driven
    /// live updates while connected.
    func watchUiSurfaceEvents(
        eventTypes: Set<String>,
        onEvent: @escaping @MainActor (UiSurfaceLiveEvent) async -> Void
    ) async throws {
        guard !eventTypes.isEmpty else { return }
        guard let connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL("/events", connection: connection))
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(status: http.statusCode, body: nil)
        }

        var currentType = ""
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            if line.hasPrefix("event: ") {
                currentType = String(line.dropFirst(7))
                continue
            }
            guard line.hasPrefix("data: "), eventTypes.contains(currentType) else {
                if line.isEmpty { currentType = "" }
                continue
            }
            let raw = String(line.dropFirst(6))
            await onEvent(Self.liveEvent(type: currentType, rawJSON: raw))
        }
    }

    private static func liveEvent(type: String, rawJSON: String) -> UiSurfaceLiveEvent {
        let object = rawJSON.data(using: .utf8).flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        }
        let timestamp = object?["timestamp"] as? String ?? ISO8601DateFormatter().string(from: Date())
        let level = UiLogLevel(rawValue: object?["level"] as? String ?? "") ?? .info
        let message = (object?["message"] as? String) ?? eventSummary(object)
        return UiSurfaceLiveEvent(type: type, timestamp: timestamp, level: level, message: message)
    }

    private static func eventSummary(_ object: [String: Any]?) -> String {
        guard let object else { return "Event received." }
        let fields = object.keys.sorted().compactMap { key -> String? in
            switch object[key] {
            case let value as String: return "\(key)=\(value)"
            case let value as NSNumber: return "\(key)=\(value)"
            default: return nil
            }
        }
        return fields.prefix(4).joined(separator: " · ").nonEmpty ?? "Event received."
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
