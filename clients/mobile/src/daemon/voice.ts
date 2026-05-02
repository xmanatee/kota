// Voice success/failure shapes. Failure carries the daemon's typed
// `code` (`stt-unavailable`, `tts-unavailable`, `tts-format-unsupported`,
// …) so the mobile UI can render the same vocabulary the CLI and web
// client use.

import type { DaemonHttp } from './http';
import { bytesToBase64, base64ToBytes } from '../voice/base64';

export type VoiceTranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; status: number; error: string; code: string };

export type VoiceSynthesizeResult =
  | { ok: true; audio: Uint8Array; mimeType: string; format: string }
  | {
      ok: false;
      status: number;
      error: string;
      code: string;
      supported?: string[];
    };

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function voiceTranscribe(
  http: DaemonHttp,
  input: {
    audio: Uint8Array;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  },
): Promise<VoiceTranscribeResult> {
  const body: Record<string, string> = {
    audioBase64: bytesToBase64(input.audio),
    mimeType: input.mimeType,
  };
  if (input.filename !== undefined) body.filename = input.filename;
  if (input.languageHint !== undefined) body.languageHint = input.languageHint;

  const res = await fetch(`${http.baseUrl}/voice/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${http.token}`,
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: stringFrom(parsed.error) || `HTTP ${res.status}`,
      code: stringFrom(parsed.code),
    };
  }
  const language = typeof parsed.language === 'string' ? parsed.language : undefined;
  return language !== undefined
    ? { ok: true, text: stringFrom(parsed.text), language }
    : { ok: true, text: stringFrom(parsed.text) };
}

export async function voiceSynthesize(
  http: DaemonHttp,
  input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  },
): Promise<VoiceSynthesizeResult> {
  const res = await fetch(`${http.baseUrl}/voice/synthesize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${http.token}`,
    },
    body: JSON.stringify(input),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const supported = Array.isArray(parsed.supported)
      ? parsed.supported.filter((v): v is string => typeof v === 'string')
      : undefined;
    const failure: VoiceSynthesizeResult = {
      ok: false,
      status: res.status,
      error: stringFrom(parsed.error) || `HTTP ${res.status}`,
      code: stringFrom(parsed.code),
    };
    return supported !== undefined ? { ...failure, supported } : failure;
  }
  return {
    ok: true,
    audio: base64ToBytes(stringFrom(parsed.audioBase64)),
    mimeType: stringFrom(parsed.mimeType),
    format: stringFrom(parsed.format),
  };
}
