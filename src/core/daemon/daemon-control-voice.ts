/**
 * Daemon control voice handlers — STT (speech-to-text) and TTS
 * (text-to-speech) endpoints exposed to clients.
 *
 * Handlers delegate to the voice module's service boundary. Clients POST
 * base64-encoded audio for transcription and receive base64-encoded audio
 * for synthesis, keeping the control API uniformly JSON.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { synthesizeSpeech, transcribeVoice } from "#modules/voice/service.js";
import {
  type SpeechAudioFormat,
  SpeechSynthesisFormatError,
  type SpeechSynthesisInput,
  SpeechSynthesisProviderUnavailableError,
  SpeechToTextProviderUnavailableError,
} from "#modules/voice/types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

const MAX_VOICE_BODY_BYTES = 16 * 1024 * 1024;

const VALID_FORMATS: readonly SpeechAudioFormat[] = [
  "mp3",
  "wav",
  "ogg",
  "opus",
  "aac",
  "flac",
  "pcm",
];

async function readJsonWithLimit(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  const body = await readBody(req);
  if (body.byteLength > MAX_VOICE_BODY_BYTES) {
    jsonResponse(res, 413, { error: "Voice request body exceeds 16MB limit" });
    return null;
  }
  if (body.byteLength === 0) {
    jsonResponse(res, 400, { error: "Request body is empty" });
    return null;
  }
  try {
    const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    return parsed;
  } catch {
    jsonResponse(res, 400, { error: "Invalid JSON body" });
    return null;
  }
}

export async function handleVoiceTranscribe(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonWithLimit(req, res);
  if (!body) return;

  const audioB64 = typeof body.audioBase64 === "string" ? body.audioBase64 : null;
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
  if (!audioB64 || !mimeType) {
    jsonResponse(res, 400, { error: "audioBase64 and mimeType are required" });
    return;
  }
  const audio = Buffer.from(audioB64, "base64");
  if (audio.byteLength === 0) {
    jsonResponse(res, 400, { error: "audioBase64 decoded to empty bytes" });
    return;
  }
  const filename = typeof body.filename === "string" ? body.filename : undefined;
  const languageHint = typeof body.languageHint === "string" ? body.languageHint : undefined;

  try {
    const result = await transcribeVoice({
      audio: new Uint8Array(audio),
      mimeType,
      ...(filename !== undefined && { filename }),
      ...(languageHint !== undefined && { languageHint }),
    });
    jsonResponse(res, 200, {
      text: result.text,
      ...(result.language !== undefined && { language: result.language }),
    });
  } catch (err) {
    if (err instanceof SpeechToTextProviderUnavailableError) {
      jsonResponse(res, 503, { error: err.message, code: "stt-unavailable" });
      return;
    }
    jsonResponse(res, 502, { error: (err as Error).message, code: "stt-failed" });
  }
}

export async function handleVoiceSynthesize(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonWithLimit(req, res);
  if (!body) return;

  const text = typeof body.text === "string" ? body.text : null;
  if (!text || !text.trim()) {
    jsonResponse(res, 400, { error: "text is required" });
    return;
  }

  const format = parseFormat(body.format);
  if (format === "invalid") {
    jsonResponse(res, 400, {
      error: `format must be one of: ${VALID_FORMATS.join(", ")}`,
    });
    return;
  }
  const voice = typeof body.voice === "string" ? body.voice : undefined;
  const languageHint = typeof body.languageHint === "string" ? body.languageHint : undefined;

  const input: SpeechSynthesisInput = {
    text,
    ...(voice !== undefined && { voice }),
    ...(languageHint !== undefined && { languageHint }),
    ...(format !== undefined && { format }),
  };

  try {
    const result = await synthesizeSpeech(input);
    jsonResponse(res, 200, {
      audioBase64: Buffer.from(result.audio).toString("base64"),
      mimeType: result.mimeType,
      format: result.format,
    });
  } catch (err) {
    if (err instanceof SpeechSynthesisProviderUnavailableError) {
      jsonResponse(res, 503, { error: err.message, code: "tts-unavailable" });
      return;
    }
    if (err instanceof SpeechSynthesisFormatError) {
      jsonResponse(res, 400, {
        error: err.message,
        code: "tts-format-unsupported",
        supported: err.supported,
      });
      return;
    }
    jsonResponse(res, 502, { error: (err as Error).message, code: "tts-failed" });
  }
}

function parseFormat(raw: unknown): SpeechAudioFormat | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return "invalid";
  return (VALID_FORMATS as readonly string[]).includes(raw) ? (raw as SpeechAudioFormat) : "invalid";
}
