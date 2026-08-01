import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelUserIdentity } from "#core/channels/channel.js";
import { resolveChannelAutonomyMode } from "#core/config/autonomy-mode-resolver.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { webhookChannelSession } from "./events.js";
import {
  readRawBody,
  resolveSecret,
  resolveSourceId,
  type SourceRoute,
  verifyHmacSignature,
  type WebhookChannelConfig,
} from "./request.js";
import {
  createAgentSession,
  directSessions,
  generateWebhookSessionId,
  sourceSessions,
  type WebhookSessionFactory,
} from "./sessions.js";

export type { SourceRoute, WebhookChannelConfig } from "./request.js";
export { resolveSourceId, verifyHmacSignature } from "./request.js";
export type { WebhookSessionFactory } from "./sessions.js";
export { clearSessions, listWebhookSessionIds } from "./sessions.js";

export type WebhookPayload = {
  agent?: string;
  message: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  source?: string;
};

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
    metadata:
      typeof obj.metadata === "object" && obj.metadata !== null
        ? (obj.metadata as Record<string, unknown>)
        : undefined,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : undefined,
    source: typeof obj.source === "string" ? obj.source : undefined,
  };
}

export function makeWebhookChannelHandler(
  ctx: ModuleContext,
  config: WebhookChannelConfig,
  createSession: WebhookSessionFactory = createAgentSession,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const secret = config.secret ? resolveSecret(config.secret) : null;

  return async (req, res) => {
    let autonomyMode: AutonomyMode;
    try {
      autonomyMode = resolveChannelAutonomyMode(
        config.defaultAutonomyMode,
        ctx.config,
        "webhook-channel",
      );
    } catch (err) {
      jsonResponse(res, 400, { error: (err as Error).message });
      return;
    }

    const body = await readRawBody(req);

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

    const sourceId = resolveSourceId(req, payload);

    if (sourceId && config.sources) {
      const sourceConfig = config.sources[sourceId];
      if (!sourceConfig) {
        jsonResponse(res, 404, { error: `Unknown source: "${sourceId}"` });
        return;
      }
      await handleSourceRequest(
        ctx,
        res,
        payload,
        sourceId,
        sourceConfig,
        autonomyMode,
        createSession,
      );
    } else {
      await handleDirectRequest(
        ctx,
        config,
        res,
        payload,
        autonomyMode,
        createSession,
      );
    }
  };
}

async function handleSourceRequest(
  ctx: ModuleContext,
  res: ServerResponse,
  payload: WebhookPayload,
  sourceId: string,
  sourceConfig: SourceRoute,
  autonomyMode: AutonomyMode,
  createSession: WebhookSessionFactory,
): Promise<void> {
  let session = sourceSessions.get(sourceId);
  const resumed = !!session;

  if (!session) {
    const id = generateWebhookSessionId();
    const moduleSession = createSession({
      label: `webhook:${sourceId}:${sourceConfig.agent}`,
      autonomyMode,
      ctx,
    });
    session = {
      id,
      createdAt: new Date().toISOString(),
      send: moduleSession.send,
      close: moduleSession.close,
    };
    sourceSessions.set(sourceId, session);
  }

  const promptParts: string[] = [];
  if (payload.metadata && !resumed) {
    promptParts.push(`[Webhook metadata: ${JSON.stringify(payload.metadata)}]`);
  }
  promptParts.push(payload.message);

  try {
    const response = await session.send(promptParts.join("\n\n"));

    const identity: ChannelUserIdentity = {
      channelUserId: `webhook:${sourceId}`,
      channel: "webhook-channel",
      meta: { source: sourceId, agent: sourceConfig.agent, ...payload.metadata },
    };

    ctx.events.emit(webhookChannelSession, {
      sessionId: session.id,
      identity,
      source: sourceId,
      resumed,
    });

    jsonResponse(res, resumed ? 200 : 201, {
      sessionId: session.id,
      source: sourceId,
      response,
      createdAt: session.createdAt,
    });
  } catch (err) {
    ctx.log.error(
      `webhook-channel: source "${sourceId}" session error: ${(err as Error).message}`,
    );
    jsonResponse(res, 500, { error: "Session execution failed" });
  }
}

async function handleDirectRequest(
  ctx: ModuleContext,
  config: WebhookChannelConfig,
  res: ServerResponse,
  payload: WebhookPayload,
  autonomyMode: AutonomyMode,
  createSession: WebhookSessionFactory,
): Promise<void> {
  const existingId = payload.sessionId;
  let session = existingId ? directSessions.get(existingId) : undefined;

  if (existingId && !session) {
    jsonResponse(res, 404, { error: `Session "${existingId}" not found` });
    return;
  }

  if (!session) {
    const id = generateWebhookSessionId();
    const agentName = payload.agent ?? config.defaultAgent;
    const moduleSession = createSession({
      label: `webhook:${id}${agentName ? `:${agentName}` : ""}`,
      autonomyMode,
      ctx,
    });
    session = {
      id,
      createdAt: new Date().toISOString(),
      send: moduleSession.send,
      close: moduleSession.close,
    };
    directSessions.set(id, session);
  }

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

    ctx.events.emit(webhookChannelSession, {
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
    ctx.log.error(
      `webhook-channel: session error: ${(err as Error).message}`,
    );
    jsonResponse(res, 500, { error: "Session execution failed" });
  }
}
