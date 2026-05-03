import AVFoundation
import Combine
import Foundation

/// Observable wrapper that the chat view uses to drive mic/speaker UI
/// off the same controller. The chat keeps three disjoint booleans
/// (`isRecording`, `isUploading`, `isSpeaking`) rather than a single enum
/// so existing chat state (streaming, error) can compose cleanly.
@MainActor
final class VoiceState: ObservableObject {
    let controller = VoiceController()
    @Published var isRecording = false
    @Published var isUploading = false
    @Published var isSpeaking = false
}

/// Owns local microphone capture and speaker playback for the macOS chat
/// surface. All vendor calls live in the daemon — this controller only
/// records bytes and plays bytes through `AVFoundation`. Recordings land
/// in a tmp file so the controller can hand the daemon a real audio mime.
@MainActor
final class VoiceController: NSObject {
    enum State {
        case idle
        case recording
        case speaking
    }

    private(set) var state: State = .idle
    private var recorder: AVAudioRecorder?
    private var recorderURL: URL?
    private var player: AVAudioPlayer?

    private let recordingMimeType = "audio/mp4"
    private let recordingExtension = "m4a"

    /// Begins a new recording. The returned URL is the destination file the
    /// recorder writes into. Throws when permission is denied or the
    /// recorder cannot be initialised.
    func startRecording() async throws {
        guard state == .idle else { return }
        try await ensureMicrophonePermission()

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("kota-voice-\(UUID().uuidString).\(recordingExtension)")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        guard recorder.prepareToRecord(), recorder.record() else {
            throw NSError(
                domain: "VoiceController",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Audio recorder failed to start."]
            )
        }
        self.recorder = recorder
        self.recorderURL = url
        state = .recording
    }

    /// Stops the active recording and returns the captured bytes plus the
    /// mime type the daemon should use. Returns nil when there was nothing
    /// to capture (e.g. the recorder produced an empty file).
    func stopRecording() -> (data: Data, mimeType: String, filename: String)? {
        guard let recorder, let url = recorderURL else {
            state = .idle
            return nil
        }
        recorder.stop()
        defer {
            self.recorder = nil
            self.recorderURL = nil
            state = .idle
            try? FileManager.default.removeItem(at: url)
        }
        guard let data = try? Data(contentsOf: url), !data.isEmpty else {
            return nil
        }
        return (data, recordingMimeType, url.lastPathComponent)
    }

    /// Plays the given audio bytes through the platform speaker. The
    /// returned task completes once playback finishes (success or error).
    /// Concurrent calls cancel the prior playback before starting.
    func play(audio: Data, mimeType: String) async throws {
        if let existing = player {
            existing.stop()
            player = nil
        }
        let player = try AVAudioPlayer(data: audio, fileTypeHint: fileTypeHint(for: mimeType))
        let delegate = PlaybackDelegate()
        player.delegate = delegate
        guard player.prepareToPlay(), player.play() else {
            throw NSError(
                domain: "VoiceController",
                code: -2,
                userInfo: [NSLocalizedDescriptionKey: "Audio player failed to start."]
            )
        }
        self.player = player
        state = .speaking
        await delegate.wait()
        if self.player === player {
            self.player = nil
            state = .idle
        }
    }

    func stopPlayback() {
        player?.stop()
        player = nil
        if state == .speaking { state = .idle }
    }

    private func fileTypeHint(for mimeType: String) -> String {
        switch mimeType {
        case "audio/mpeg": return AVFileType.mp3.rawValue
        case "audio/wav", "audio/x-wav": return AVFileType.wav.rawValue
        case "audio/ogg": return "org.xiph.ogg"
        case "audio/aac": return "public.aac-audio"
        case "audio/mp4", "audio/x-m4a": return AVFileType.m4a.rawValue
        case "audio/flac": return "org.xiph.flac"
        default: return AVFileType.m4a.rawValue
        }
    }

    /// Bridges `AVAudioPlayerDelegate`'s completion callback into async/await
    /// without keeping a non-Sendable `AVAudioPlayer` alive on a background
    /// thread. One-shot: `wait()` resumes on the first `didFinishPlaying` or
    /// decode error, whichever fires first.
    private final class PlaybackDelegate: NSObject, AVAudioPlayerDelegate, @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<Void, Never>?
        private var finished = false

        func wait() async {
            await withCheckedContinuation { cont in
                lock.lock()
                if finished {
                    lock.unlock()
                    cont.resume()
                    return
                }
                continuation = cont
                lock.unlock()
            }
        }

        private func resumeOnce() {
            lock.lock()
            if finished {
                lock.unlock()
                return
            }
            finished = true
            let cont = continuation
            continuation = nil
            lock.unlock()
            cont?.resume()
        }

        func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
            resumeOnce()
        }

        func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
            resumeOnce()
        }
    }

    /// Requests microphone access if the app has not yet been granted it.
    /// Throws when access is denied or restricted so the chat UI can surface
    /// the failure as a typed code instead of silently producing empty audio.
    private func ensureMicrophonePermission() async throws {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        switch status {
        case .authorized:
            return
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            if !granted {
                throw NSError(
                    domain: "VoiceController",
                    code: -3,
                    userInfo: [NSLocalizedDescriptionKey: "Microphone access denied."]
                )
            }
        case .denied, .restricted:
            throw NSError(
                domain: "VoiceController",
                code: -3,
                userInfo: [NSLocalizedDescriptionKey: "Microphone access denied."]
            )
        @unknown default:
            throw NSError(
                domain: "VoiceController",
                code: -3,
                userInfo: [NSLocalizedDescriptionKey: "Microphone access in unknown state."]
            )
        }
    }
}
