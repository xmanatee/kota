/**
 * Inbound webhook channel — generic HTTP webhook-to-session channel.
 *
 * Registers `POST /api/channels/webhook` as a module route. External services
 * POST a JSON payload with optional `agent`, `message`, and `metadata` fields.
 * The channel creates (or resumes) a session and returns a session reference.
 *
 * Supports optional HMAC-SHA256 signature verification via config.
 *
 * Config (kota.config under modules["webhook-channel"]):
 *   {
 *     secret?: string,       // HMAC secret or "$ENV_VAR" reference
 *     defaultAgent?: string  // Agent name if payload doesn't specify one
 *   }
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelDef, ChannelUserIdentity } from "#core/channels/channel.js";
import type {
  KotaModule,
  ModuleContext,
  RouteRegistration,
} from "#core/modules/module-types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type WebhookChannelConfig = {
  /** HMAC-SHA256 secret for signature verification. "$ENV_VAR" references supported. */
  secret?: string;
  /** Default agent name when the payload omits `agent`. */
  defaultAgent?: string;
};

// ─── Payload ─────────────────────────────────────────────────────────────────

export type WebhookPayload = {
  /** Agent name to handle the session. Optional. */
  agent?: string;
  /** Message to send to the agent. Required. */
  message: string;
  /** Arbitrary metadata forwarded as session context. */
  metadata?: Record<string, unknown>;
  /** Session ID to resume. Omit to create a new session. */
  sessionId?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveSecret(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX) {
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

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parsePayload(raw: unknown): WebhookPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message !== "string" || !obj.message) return null;
  return {
    message: obj.message,
    agent: typeof obj.agent === "string" ? obj.agent : undefined,
    metadata: typeof obj.metadata === "object" && obj.metadata !== null
      ? obj.metadata as Record<string, unknown>
      : undefined,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
  };
}

// ─── Session management ─────────────────────────────────────────────────────

type WebhookSession = {
  id: string;
  createdAt: string;
  send: (prompt: string) => Promise<string>;
  close: () => void;
};

const sessions = new Map<string, WebhookSession>();
let nextSessionId = 1;

function generateSessionId(): string {
  return `wh-${Date.now().toString(36)}-${(nextSessionId++).toString(36)}`;
}

// ─── Route handler factory ───────────────────────────────────────────────────

export function makeWebhookChannelHandler(
  ctx: ModuleContext,
  config: WebhookChannelConfig,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const secret = config.secret ? resolveSecret(config.secret) : null;

  return async (req, res) => {
    const body = await readRawBody(req);

    // HMAC verification when secret is configured
    if (secret) {
      const signature = req.headers["x-webhook-signature"];
      if (typeof signature !== "string") {
        ctx.log.warn("webhook-channel: missing X-Webhook-Signature header");
        jsonResponse(res, 401, { error: "Missing X-Webhook-Signature header" });
        return;
      }
      if (!verifyHmacSignature(secret, body, signature)) {
        ctx.log.warn("webhook-channel: invalid HMAC signature — rejected");
        jsonResponse(res, 401, { error: "Invalid signature" });
        return;
      }
    }

    // Parse JSON body
    let rawPayload: unknown;
    try {
      rawPayload = body.length ? JSON.parse(body.toString("utf-8")) : null;
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const payload = parsePayload(rawPayload);
    if (!payload) {
      jsonResponse(res, 400, {
        error: 'Invalid payload: "message" (string) is required',
      });
      return;
    }

    // Resume existing session or create new
    const existingId = payload.sessionId;
    let session = existingId ? sessions.get(existingId) : undefined;

    if (existingId && !session) {
      jsonResponse(res, 404, { error: `Session "${existingId}" not found` });
      return;
    }

    if (!session) {
      const id = generateSessionId();
      const agentName = payload.agent ?? config.defaultAgent;

      // Build prompt with metadata context
      const contextParts: string[] = [];
      if (agentName) contextParts.push(`Agent: ${agentName}`);
      if (payload.metadata) {
        contextParts.push(`Context: ${JSON.stringify(payload.metadata)}`);
      }

      const moduleSession = ctx.createSession({
        label: `webhook:${id}`,
        noHistory: false,
      });

      session = {
        id,
        createdAt: new Date().toISOString(),
        send: moduleSession.send,
        close: moduleSession.close,
      };
      sessions.set(id, session);
    }

    // Build prompt including metadata for context
    const promptParts: string[] = [];
    if (payload.metadata && !existingId) {
      promptParts.push(`[Webhook metadata: ${JSON.stringify(payload.metadata)}]`);
    }
    promptParts.push(payload.message);

    try {
      const response = await session.send(promptParts.join("\n\n"));

      const identity: ChannelUserIdentity = {
        channelUserId: `webhook:${session.id}`,
        channel: "webhook-channel",
        meta: payload.metadata,
      };

      ctx.events.emit("webhook-channel.session", {
        sessionId: session.id,
        identity,
        resumed: !!existingId,
      });

      jsonResponse(res, existingId ? 200 : 201, {
        sessionId: session.id,
        response,
        createdAt: session.createdAt,
      });
    } catch (err) {
      ctx.log.error(`webhook-channel: session error: ${(err as Error).message}`);
      jsonResponse(res, 500, { error: "Session execution failed" });
    }
  };
}

// ─── Channel definition ─────────────────────────────────────────────────────

function makeChannelDef(ctx: ModuleContext): ChannelDef {
  return {
    name: "webhook-channel",
    description:
      "Generic inbound HTTP webhook channel — creates agent sessions from JSON payloads",
    create() {
      return {
        async start() {
          ctx.log.info("webhook-channel: channel started");
        },
        stop() {
          // Clean up all managed sessions
          for (const session of sessions.values()) {
            session.close();
          }
          sessions.clear();
          nextSessionId = 1;
          ctx.log.info("webhook-channel: channel stopped");
        },
      };
    },
  };
}

// ─── Module ──────────────────────────────────────────────────────────────────

const webhookChannelModule: KotaModule = {
  name: "webhook-channel",
  version: "1.0.0",
  description:
    "Inbound webhook-to-session channel — external services POST JSON to create agent sessions",

  channels: (ctx) => [makeChannelDef(ctx)],

  routes: (ctx): RouteRegistration[] => {
    const config = ctx.getModuleConfig<WebhookChannelConfig>() ?? {};
    return [
      {
        method: "POST",
        path: "/api/channels/webhook",
        bypassAuth: true,
        handler: makeWebhookChannelHandler(ctx, config),
      },
    ];
  },
};

export default webhookChannelModule;
