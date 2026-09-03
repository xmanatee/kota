import Foundation

extension DaemonClient {
    func fetchUiSurfaceBundle(scopeId: String? = nil) async throws -> UiSurfaceBundle {
        try await get(Self.withScope("/ui/surfaces", scopeId: scopeId))
    }

    func executeUiAction(
        _ action: UiAction,
        parameters: [String: UiJsonValue]? = nil,
        confirmed: Bool = false
    ) async throws -> UiActionExecutionResult {
        let body = try JSONEncoder().encode(UiActionExecuteRequest(
            surfaceId: action.surfaceId,
            actionId: action.actionId,
            scopeId: action.scopeId,
            parameters: parameters,
            confirmed: confirmed ? true : nil
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
        afterEventId: String? = nil,
        onEvent: @escaping @MainActor (UiSurfaceLiveEvent) async -> Void
    ) async throws {
        guard !eventTypes.isEmpty else { return }
        guard let connection else { throw DaemonClientError.notConnected }
        var request = URLRequest(url: routeURL("/events", connection: connection))
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let afterEventId, !afterEventId.isEmpty {
            request.setValue(afterEventId, forHTTPHeaderField: "Last-Event-ID")
        }

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DaemonClientError.httpError(status: http.statusCode, body: nil)
        }

        var currentId: String?
        var currentType: String?
        var dataLines: [String] = []
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            if line.isEmpty {
                if let currentType, eventTypes.contains(currentType), !dataLines.isEmpty {
                    await onEvent(Self.liveEvent(
                        id: currentId,
                        type: currentType,
                        rawJSON: dataLines.joined(separator: "\n")
                    ))
                }
                currentId = nil
                currentType = nil
                dataLines = []
            } else if line.hasPrefix("id:") {
                currentId = Self.sseFieldValue(line, prefixLength: 3)
            } else if line.hasPrefix("event:") {
                currentType = Self.sseFieldValue(line, prefixLength: 6)
            } else if line.hasPrefix("data:") {
                dataLines.append(Self.sseFieldValue(line, prefixLength: 5))
            }
        }
        if let currentType, eventTypes.contains(currentType), !dataLines.isEmpty {
            await onEvent(Self.liveEvent(
                id: currentId,
                type: currentType,
                rawJSON: dataLines.joined(separator: "\n")
            ))
        }
    }

    private static func sseFieldValue(_ line: String, prefixLength: Int) -> String {
        String(line.dropFirst(prefixLength)).drop(while: { $0 == " " }).description
    }

    private static func liveEvent(id: String?, type: String, rawJSON: String) -> UiSurfaceLiveEvent {
        let object = rawJSON.data(using: .utf8).flatMap {
            try? JSONSerialization.jsonObject(with: $0) as? [String: Any]
        }
        let timestamp = object?["timestamp"] as? String ?? ISO8601DateFormatter().string(from: Date())
        let level = UiLogLevel(rawValue: object?["level"] as? String ?? "") ?? .info
        let message = (object?["message"] as? String) ?? eventSummary(object)
        let scopeId = object?["scopeId"] as? String
        return UiSurfaceLiveEvent(
            id: id,
            type: type,
            scopeId: scopeId,
            timestamp: timestamp,
            level: level,
            message: message
        )
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
