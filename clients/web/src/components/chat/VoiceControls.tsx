/**
 * Voice controls for the web chat surface.
 *
 * Microphone capture goes through `MediaRecorder` → POST /api/voice/transcribe
 * → text is handed back to the chat input via `onTranscript`.
 *
 * Speaker playback synthesizes the latest assistant text via
 * POST /api/voice/synthesize and plays it through an in-memory <audio>.
 *
 * Both surfaces forward the daemon's typed failure codes
 * (stt-unavailable, tts-unavailable, tts-format-unsupported) back to the
 * caller through `onError` so the chat shell can render a banner that
 * matches the CLI vocabulary one-to-one.
 */

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";

type VoiceError = { code: string; message: string };

export type VoiceControlsProps = {
  /** Latest assistant text the speaker button should synthesize. */
  speakableText: string | null;
  /** Called with transcribed text when a recording finishes successfully. */
  onTranscript: (text: string) => void;
  /** Called with a typed error whenever a voice action fails. */
  onError: (err: VoiceError) => void;
  /** Optional language hint for both directions (BCP-47). */
  languageHint?: string;
  /** Optional override for the test seam — defaults to navigator.mediaDevices. */
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  /** Optional override for the test seam — defaults to window.MediaRecorder. */
  mediaRecorderCtor?: typeof MediaRecorder;
};

type RecordingState =
  | { status: "idle" }
  | {
      status: "recording";
      recorder: MediaRecorder;
      chunks: Blob[];
      stream: MediaStream;
    }
  | { status: "uploading" };

export function VoiceControls({
  speakableText,
  onTranscript,
  onError,
  languageHint,
  mediaDevices,
  mediaRecorderCtor,
}: VoiceControlsProps) {
  const [recording, setRecording] = useState<RecordingState>({
    status: "idle",
  });
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (recording.status === "recording") {
        try {
          for (const track of recording.stream.getTracks()) track.stop();
        } catch {
          // ignore — best-effort cleanup
        }
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, [recording]);

  const devices = mediaDevices ?? globalThis.navigator?.mediaDevices;
  const RecorderCtor =
    mediaRecorderCtor ??
    (typeof window !== "undefined"
      ? (window as unknown as { MediaRecorder?: typeof MediaRecorder })
          .MediaRecorder
      : undefined);
  const recordingSupported = !!devices?.getUserMedia && !!RecorderCtor;

  async function startRecording() {
    if (!devices || !RecorderCtor) {
      onError({
        code: "stt-unsupported",
        message: "This browser does not support microphone capture.",
      });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await devices.getUserMedia({ audio: true });
    } catch (err) {
      onError({
        code: "stt-mic-denied",
        message: `Microphone access failed: ${(err as Error).message}`,
      });
      return;
    }
    const mimeType = pickMimeType(RecorderCtor);
    const recorder = mimeType
      ? new RecorderCtor(stream, { mimeType })
      : new RecorderCtor(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      void finishRecording(
        chunks,
        recorder.mimeType || mimeType || "audio/webm",
        stream,
      );
    });
    recorder.start();
    setRecording({ status: "recording", recorder, chunks, stream });
  }

  function stopRecording() {
    if (recording.status !== "recording") return;
    recording.recorder.stop();
  }

  async function finishRecording(
    chunks: Blob[],
    mimeType: string,
    stream: MediaStream,
  ) {
    for (const track of stream.getTracks()) track.stop();
    if (chunks.length === 0) {
      setRecording({ status: "idle" });
      onError({
        code: "stt-empty-recording",
        message: "Recording produced no audio data.",
      });
      return;
    }
    setRecording({ status: "uploading" });
    const blob = new Blob(chunks, { type: mimeType });
    const result = await api.voiceTranscribe({
      audio: blob,
      mimeType,
      filename: `web-voice.${extensionFromMime(mimeType)}`,
      ...(languageHint !== undefined && { languageHint }),
    });
    setRecording({ status: "idle" });
    if (!result.ok) {
      onError({
        code: result.code || `http-${result.status}`,
        message: result.error,
      });
      return;
    }
    if (!result.text.trim()) {
      onError({
        code: "stt-empty-transcript",
        message: "Voice provider returned no text.",
      });
      return;
    }
    onTranscript(result.text);
  }

  async function speakLatest() {
    if (!speakableText || !speakableText.trim() || speaking) return;
    setSpeaking(true);
    const result = await api.voiceSynthesize({
      text: speakableText,
      ...(languageHint !== undefined && { languageHint }),
    });
    if (!result.ok) {
      setSpeaking(false);
      onError({
        code: result.code || `http-${result.status}`,
        message: result.error,
      });
      return;
    }
    const url = URL.createObjectURL(result.audio);
    const audio = new Audio(url);
    audioRef.current = audio;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      setSpeaking(false);
    };
    audio.addEventListener("ended", cleanup);
    audio.addEventListener("error", () => {
      cleanup();
      onError({
        code: "tts-playback-failed",
        message: "Browser failed to play the synthesized audio.",
      });
    });
    try {
      await audio.play();
    } catch (err) {
      cleanup();
      onError({
        code: "tts-playback-failed",
        message: `Audio playback rejected: ${(err as Error).message}`,
      });
    }
  }

  const isRecording = recording.status === "recording";
  const isUploading = recording.status === "uploading";

  return (
    <div className="flex items-center gap-1" data-testid="voice-controls">
      <Button
        type="button"
        variant={isRecording ? "destructive" : "outline"}
        size="icon"
        title={
          isRecording
            ? "Stop recording"
            : isUploading
              ? "Transcribing..."
              : recordingSupported
                ? "Record voice"
                : "Microphone capture not supported in this browser"
        }
        aria-pressed={isRecording}
        aria-label={isRecording ? "Stop recording" : "Record voice"}
        disabled={isUploading || !recordingSupported}
        onClick={() => {
          if (isRecording) {
            stopRecording();
          } else {
            void startRecording();
          }
        }}
      >
        {isRecording ? "■" : isUploading ? "…" : "\u{1F3A4}"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title={
          speakableText
            ? speaking
              ? "Speaking..."
              : "Speak latest reply"
            : "No reply to speak yet"
        }
        aria-label="Speak latest reply"
        disabled={!speakableText || speaking}
        onClick={() => void speakLatest()}
      >
        {speaking ? "♫" : "\u{1F50A}"}
      </Button>
    </div>
  );
}

function pickMimeType(Ctor: typeof MediaRecorder): string | null {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
  ];
  const probe = (
    Ctor as unknown as { isTypeSupported?: (t: string) => boolean }
  ).isTypeSupported;
  if (typeof probe !== "function") return null;
  for (const candidate of candidates) {
    if (probe.call(Ctor, candidate)) return candidate;
  }
  return null;
}

function extensionFromMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "bin";
}
