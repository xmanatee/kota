/**
 * HTTP routes for `kota serve` — exposes voice STT and TTS endpoints at
 * `/api/voice/*` so web, macOS, mobile, and any other non-CLI client can
 * reach the voice surface without embedding daemon-control URLs.
 *
 * Both routes take and return JSON with base64-encoded audio, matching the
 * daemon-control handler shape.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import { synthesizeSpeech, transcribeVoice } from "./service.js";
import {
  type SpeechAudioFormat,
  SpeechSynthesisFormatError,
  type SpeechSynthesisInput,
  SpeechSynthesisProviderUnavailableError,
  SpeechToTextProviderUnavailableError,
} from "./types.js";

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

async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let resolved = false;
    req.on("data", (chunk: Buffer) => {
      if (resolved) return;
      size += chunk.byteLength;
      if (size > MAX_VOICE_BODY_BYTES) {
        resolved = true;
        jsonResponse(res, 413, { error: "Voice request body exceeds 16MB limit" });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (resolved) return;
      resolved = true;
      if (size === 0) {
        jsonResponse(res, 400, { error: "Request body is empty" });
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON body" });
        resolve(null);
      }
    });
    req.on("error", () => {
      if (resolved) return;
      resolved = true;
      jsonResponse(res, 400, { error: "Failed to read body" });
      resolve(null);
    });
  });
}

async function transcribeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res);
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

async function synthesizeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;
  const text = typeof body.text === "string" ? body.text : null;
  if (!text || !text.trim()) {
    jsonResponse(res, 400, { error: "text is required" });
    return;
  }
  const format = parseFormat(body.format);
  if (format === "invalid") {
    jsonResponse(res, 400, { error: `format must be one of: ${VALID_FORMATS.join(", ")}` });
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

export function voiceRoutes(): RouteRegistration[] {
  return [
    { method: "POST", path: "/api/voice/transcribe", handler: transcribeHandler },
    { method: "POST", path: "/api/voice/synthesize", handler: synthesizeHandler },
  ];
}
