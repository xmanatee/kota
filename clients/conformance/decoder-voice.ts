import { asBool, asInt, asObject, asOptionalString, asOptionalStringArray, asString, fail } from './decoder-common';

// MARK: - Voice failure envelopes
//
// The voice success surfaces (`POST /voice/transcribe` with audio attached;
// the synthesize route returning audio bytes) carry binary payloads outside
// the JSON contract — only the failure envelopes are exercised here.

export type VoiceFailure = {
  ok: false;
  status: number;
  error: string;
  code: string;
  supported?: string[];
};

export type VoiceTranscribeSuccess = {
  ok: true;
  text: string;
  language?: string;
};

export type VoiceTranscribeResult = VoiceTranscribeSuccess | VoiceFailure;

export function parseVoiceTranscribeResult(raw: unknown): VoiceTranscribeResult {
  const obj = asObject(raw, "voice");
  const ok = asBool(obj.ok, "voice.ok");
  if (ok) {
    return {
      ok: true,
      text: asString(obj.text, "voice.text"),
      language: asOptionalString(obj.language, "voice.language"),
    };
  }
  return parseVoiceFailure(obj);
}

export function parseVoiceFailure(obj: Record<string, unknown>): VoiceFailure {
  const code = asString(obj.code, "voice.code");
  const KNOWN = new Set([
    "stt-unavailable",
    "stt-failed",
    "tts-unavailable",
    "tts-failed",
    "tts-format-unsupported",
  ]);
  if (!KNOWN.has(code)) {
    return fail(`unknown voice failure code: ${code}`);
  }
  return {
    ok: false,
    status: asInt(obj.status, "voice.status"),
    error: asString(obj.error, "voice.error"),
    code,
    supported: asOptionalStringArray(obj.supported, "voice.supported"),
  };
}
