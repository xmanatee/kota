/**
 * HTTP routes for the voice module. Two client surfaces share a single set
 * of handlers:
 *
 * - `voiceRoutes()` contributes `/api/voice/*` to the `kota serve` HTTP
 *   server (web, macOS, mobile over `/api/*`).
 * - `voiceControlRoutes()` contributes `/voice/*` to the daemon-control
 *   server through the module-owned control-route seam.
 *
 * Both surfaces accept and return JSON with base64-encoded audio and emit
 * identical envelopes (status codes, error codes, `supported` hints) so
 * every client handles the same shape regardless of which server answered.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration, RouteRegistration } from "#core/modules/module-types.js";
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

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let resolved = false;
    const finish = (status: number, body: Record<string, unknown>): void => {
      if (resolved) return;
      resolved = true;
      sendJson(res, status, body);
      resolve(null);
    };
    req.on("data", (chunk: Buffer) => {
      if (resolved) return;
      size += chunk.byteLength;
      if (size > MAX_VOICE_BODY_BYTES) {
        finish(413, { error: "Voice request body exceeds 16MB limit" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (resolved) return;
      if (size === 0) {
        finish(400, { error: "Request body is empty" });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        finish(400, { error: "Invalid JSON body" });
        return;
      }
      resolved = true;
      resolve(parsed);
    });
    req.on("error", () => {
      finish(400, { error: "Failed to read body" });
    });
  });
}

export async function handleVoiceTranscribe(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;

  const audioB64 = typeof body.audioBase64 === "string" ? body.audioBase64 : null;
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
  if (!audioB64 || !mimeType) {
    sendJson(res, 400, { error: "audioBase64 and mimeType are required" });
    return;
  }
  const audio = Buffer.from(audioB64, "base64");
  if (audio.byteLength === 0) {
    sendJson(res, 400, { error: "audioBase64 decoded to empty bytes" });
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
    sendJson(res, 200, {
      text: result.text,
      ...(result.language !== undefined && { language: result.language }),
    });
  } catch (err) {
    if (err instanceof SpeechToTextProviderUnavailableError) {
      sendJson(res, 503, { error: err.message, code: "stt-unavailable" });
      return;
    }
    sendJson(res, 502, { error: (err as Error).message, code: "stt-failed" });
  }
}

export async function handleVoiceSynthesize(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody(req, res);
  if (!body) return;

  const text = typeof body.text === "string" ? body.text : null;
  if (!text || !text.trim()) {
    sendJson(res, 400, { error: "text is required" });
    return;
  }

  const format = parseFormat(body.format);
  if (format === "invalid") {
    sendJson(res, 400, {
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
    sendJson(res, 200, {
      audioBase64: Buffer.from(result.audio).toString("base64"),
      mimeType: result.mimeType,
      format: result.format,
    });
  } catch (err) {
    if (err instanceof SpeechSynthesisProviderUnavailableError) {
      sendJson(res, 503, { error: err.message, code: "tts-unavailable" });
      return;
    }
    if (err instanceof SpeechSynthesisFormatError) {
      sendJson(res, 400, {
        error: err.message,
        code: "tts-format-unsupported",
        supported: err.supported,
      });
      return;
    }
    sendJson(res, 502, { error: (err as Error).message, code: "tts-failed" });
  }
}

function parseFormat(raw: unknown): SpeechAudioFormat | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return "invalid";
  return (VALID_FORMATS as readonly string[]).includes(raw) ? (raw as SpeechAudioFormat) : "invalid";
}

export function voiceRoutes(): RouteRegistration[] {
  return [
    { method: "POST", path: "/api/voice/transcribe", handler: handleVoiceTranscribe },
    { method: "POST", path: "/api/voice/synthesize", handler: handleVoiceSynthesize },
  ];
}

export function voiceControlRoutes(): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/voice/transcribe",
      capabilityScope: "control",
      handler: handleVoiceTranscribe,
    },
    {
      method: "POST",
      path: "/voice/synthesize",
      capabilityScope: "control",
      handler: handleVoiceSynthesize,
    },
  ];
}
