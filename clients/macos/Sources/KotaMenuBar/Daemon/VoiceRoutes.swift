import Foundation

extension DaemonClient {
    /// Posts captured audio to `/voice/transcribe` and decodes the typed
    /// success or failure shape. Failures preserve the daemon's `code`
    /// (`stt-unavailable`, `stt-failed`, …) so the UI can render the same
    /// vocabulary the CLI and web client use.
    func voiceTranscribe(
        audio: Data,
        mimeType: String,
        filename: String? = nil,
        languageHint: String? = nil
    ) async throws -> VoiceTranscribeResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var payload: [String: Any] = [
            "audioBase64": audio.base64EncodedString(),
            "mimeType": mimeType,
        ]
        if let filename { payload["filename"] = filename }
        if let languageHint { payload["languageHint"] = languageHint }
        let body = try JSONSerialization.data(withJSONObject: payload)

        var request = URLRequest(url: conn.baseURL.appendingPathComponent("/voice/transcribe"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if !(200..<300).contains(status) {
            return .failure(failureFromPayload(status: status, payload: parsed))
        }
        let text = parsed["text"] as? String ?? ""
        let language = parsed["language"] as? String
        return .success(text: text, language: language)
    }

    /// Posts text to `/voice/synthesize` and decodes the typed success or
    /// failure shape. The success branch returns raw audio bytes plus
    /// mime and format so callers can hand both to a platform player.
    func voiceSynthesize(
        text: String,
        voice: String? = nil,
        languageHint: String? = nil,
        format: String? = nil
    ) async throws -> VoiceSynthesizeResult {
        guard let conn = connection else { throw DaemonClientError.notConnected }
        var payload: [String: Any] = ["text": text]
        if let voice { payload["voice"] = voice }
        if let languageHint { payload["languageHint"] = languageHint }
        if let format { payload["format"] = format }
        let body = try JSONSerialization.data(withJSONObject: payload)

        var request = URLRequest(url: conn.baseURL.appendingPathComponent("/voice/synthesize"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(conn.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if !(200..<300).contains(status) {
            return .failure(failureFromPayload(status: status, payload: parsed))
        }
        let audioBase64 = parsed["audioBase64"] as? String ?? ""
        guard let audio = Data(base64Encoded: audioBase64) else {
            return .failure(VoiceFailure(
                status: status,
                error: "Daemon returned malformed audioBase64",
                code: "tts-malformed-response",
                supportedFormats: nil
            ))
        }
        let mimeType = parsed["mimeType"] as? String ?? "application/octet-stream"
        let format = parsed["format"] as? String ?? ""
        return .success(audio: audio, mimeType: mimeType, format: format)
    }

    private func failureFromPayload(status: Int, payload: [String: Any]) -> VoiceFailure {
        let error = (payload["error"] as? String) ?? "HTTP \(status)"
        let code = payload["code"] as? String
        let supported = (payload["supported"] as? [String])
            ?? (payload["supported"] as? [Any])?.compactMap { $0 as? String }
        return VoiceFailure(status: status, error: error, code: code, supportedFormats: supported)
    }
}
