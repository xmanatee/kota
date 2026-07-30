import { apiFetch } from "./client-runtime";

export type VoiceTranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; status: number; error: string; code: string };

export type VoiceSynthesizeResult =
  | { ok: true; audio: Blob; mimeType: string; format: string }
  | { ok: false; status: number; error: string; code: string };

export const voiceApi = {
  voiceTranscribe: async (input: {
    audio: Blob;
    mimeType: string;
    filename?: string;
    languageHint?: string;
  }): Promise<VoiceTranscribeResult> => {
    const audioBase64 = await blobToBase64(input.audio);
    const response = await apiFetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        mimeType: input.mimeType,
        ...(input.filename !== undefined && { filename: input.filename }),
        ...(input.languageHint !== undefined && { languageHint: input.languageHint }),
      }),
    });
    const parsed = await readRecord(response);
    if (!response.ok) return daemonVoiceError(response.status, parsed);
    return {
      ok: true,
      text: asString(parsed.text),
      language: typeof parsed.language === "string" ? parsed.language : undefined,
    };
  },
  voiceSynthesize: async (input: {
    text: string;
    voice?: string;
    languageHint?: string;
    format?: string;
  }): Promise<VoiceSynthesizeResult> => {
    const response = await apiFetch("/api/voice/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const parsed = await readRecord(response);
    if (!response.ok) return daemonVoiceError(response.status, parsed);
    const mimeType = asString(parsed.mimeType);
    return {
      ok: true,
      audio: base64ToBlob(
        asString(parsed.audioBase64),
        mimeType || "application/octet-stream",
      ),
      mimeType,
      format: asString(parsed.format),
    };
  },
};

async function readRecord(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function daemonVoiceError(
  status: number,
  parsed: Record<string, unknown>,
): VoiceTranscribeResult & VoiceSynthesizeResult {
  return {
    ok: false,
    status,
    error: asString(parsed.error) || `HTTP ${status}`,
    code: asString(parsed.code),
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("FileReader did not return a string"));
        return;
      }
      const comma = reader.result.indexOf(",");
      resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
