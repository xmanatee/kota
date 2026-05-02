import Foundation

// Voice success/failure shapes for the daemon's `/voice/transcribe`
// and `/voice/synthesize` routes. Failure carries the typed `code`
// (`stt-unavailable`, `tts-unavailable`, `tts-format-unsupported`,
// `stt-failed`, `tts-failed`) so the UI renders the same vocabulary
// the CLI and web client use.

struct VoiceFailure {
    let status: Int
    let error: String
    let code: String?
    let supportedFormats: [String]?
}

enum VoiceTranscribeResult {
    case success(text: String, language: String?)
    case failure(VoiceFailure)
}

enum VoiceSynthesizeResult {
    case success(audio: Data, mimeType: String, format: String)
    case failure(VoiceFailure)
}
