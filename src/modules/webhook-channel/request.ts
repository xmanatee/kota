import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { WebhookPayload } from "./handler.js";

export type SourceRoute = { agent: string };

export type WebhookChannelConfig = {
  secret?: string;
  defaultAgent?: string;
  defaultAutonomyMode?: AutonomyMode;
  sources?: Record<string, SourceRoute>;
};

export function resolveSecret(raw: string): string {
  return raw.startsWith("$") ? process.env[raw.slice(1)] ?? "" : raw;
}

export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function verifyHmacSignature(
  secret: string,
  body: Buffer,
  signature: string,
): boolean {
  const prefix = "sha256=";
  if (!signature.startsWith(prefix)) return false;
  const expected = `${prefix}${createHmac("sha256", secret).update(body).digest("hex")}`;
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

const BASE_PATH = "/api/channels/webhook";

export function resolveSourceId(
  req: IncomingMessage,
  payload: WebhookPayload,
): string | null {
  const path = (req.url ?? "/").split("?")[0];
  if (path.startsWith(`${BASE_PATH}/`)) {
    const suffix = decodeURIComponent(path.slice(BASE_PATH.length + 1));
    if (suffix) return suffix;
  }
  const header = req.headers["x-webhook-source"];
  if (typeof header === "string" && header) return header;
  return payload.source ?? null;
}
