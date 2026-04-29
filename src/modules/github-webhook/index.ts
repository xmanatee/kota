/**
 * GitHub webhook module — receives GitHub webhook deliveries and emits typed bus events.
 *
 * Registers `POST /api/webhooks/github` and validates each delivery's HMAC-SHA256
 * signature before emitting a `github.<event>` bus event. Workflows can trigger on
 * these events via `event: "github.push"`, `event: "github.pull_request"`, etc.
 *
 * Config (under modules.github-webhook):
 *   secret:  Webhook secret or "$ENV_VAR" reference. Required.
 *   events:  Event types to accept. Default: ["push", "pull_request", "check_run"].
 *
 * Invalid signatures are rejected with HTTP 401 and a warning log.
 * Unrecognised/unconfigured event types return HTTP 200 with `ignored: true`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  KotaModule,
  ModuleContext,
  RouteRegistration,
} from "#core/modules/module-types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type GitHubWebhookConfig = {
  /** Webhook secret or "$ENV_VAR" reference. Required. */
  secret: string;
  /** Event types to accept. Default: ["push", "pull_request", "check_run"]. */
  events?: string[];
};

const DEFAULT_EVENTS = ["push", "pull_request", "check_run"];

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

function verifySignature(secret: string, body: Buffer, signature: string): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function normalizePayload(
  eventType: string,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const repo =
    (raw.repository as Record<string, unknown> | undefined)?.full_name ?? null;

  if (eventType === "push") {
    const ref = typeof raw.ref === "string" ? raw.ref : null;
    return {
      repo,
      ref,
      branch: ref ? ref.replace("refs/heads/", "") : null,
      commits: Array.isArray(raw.commits) ? raw.commits.length : 0,
      pusher: (raw.pusher as Record<string, unknown> | undefined)?.name ?? null,
    };
  }

  if (eventType === "pull_request") {
    const pr = raw.pull_request as Record<string, unknown> | undefined;
    const headRepo =
      ((pr?.head as Record<string, unknown> | undefined)?.repo as Record<string, unknown> | undefined)
        ?.full_name ?? null;
    return {
      repo,
      action: raw.action ?? null,
      number: raw.number ?? null,
      title: pr?.title ?? null,
      state: pr?.state ?? null,
      merged: pr?.merged ?? null,
      headBranch: (pr?.head as Record<string, unknown> | undefined)?.ref ?? null,
      baseBranch: (pr?.base as Record<string, unknown> | undefined)?.ref ?? null,
      headRepo,
      isFork: typeof headRepo === "string" && typeof repo === "string" ? headRepo !== repo : null,
    };
  }

  if (eventType === "check_run") {
    const checkRun = raw.check_run as Record<string, unknown> | undefined;
    return {
      repo,
      action: raw.action ?? null,
      name: checkRun?.name ?? null,
      status: checkRun?.status ?? null,
      conclusion: checkRun?.conclusion ?? null,
    };
  }

  return { repo };
}

// ─── Route handler factory ────────────────────────────────────────────────────

function makeWebhookHandler(
  secret: string,
  enabledEvents: Set<string>,
  ctx: ModuleContext,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const signature = req.headers["x-hub-signature-256"];
    const eventType = req.headers["x-github-event"];

    if (typeof signature !== "string") {
      ctx.log.warn("github-webhook: missing X-Hub-Signature-256 — delivery rejected");
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing signature" }));
      return;
    }

    if (typeof eventType !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing X-GitHub-Event header" }));
      return;
    }

    const body = await readRawBody(req);

    if (!verifySignature(secret, body, signature)) {
      ctx.log.warn("github-webhook: invalid HMAC signature — delivery rejected");
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid signature" }));
      return;
    }

    if (!enabledEvents.has(eventType)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, ignored: true, event: eventType }));
      return;
    }

    let rawPayload: Record<string, unknown>;
    try {
      rawPayload = body.length ? (JSON.parse(body.toString("utf-8")) as Record<string, unknown>) : {};
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    const payload = normalizePayload(eventType, rawPayload);
    ctx.events.emitExternal(`github.${eventType}`, payload);
    ctx.log.info(`github-webhook: emitted github.${eventType}`, { repo: payload.repo });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, event: `github.${eventType}` }));
  };
}

// ─── Module ───────────────────────────────────────────────────────────────

function resolveActiveSecret(ctx: ModuleContext): string | null {
  const config = ctx.getModuleConfig<GitHubWebhookConfig>();
  if (!config?.secret) return null;
  const secret = resolveSecret(config.secret);
  return secret || null;
}

const githubWebhookModule: KotaModule = {
  name: "github-webhook",
  version: "1.0.0",
  description:
    "GitHub webhook receiver — validates HMAC signatures and emits typed github.* bus events",

  routes: (ctx: ModuleContext): RouteRegistration[] => {
    const secret = resolveActiveSecret(ctx);
    if (!secret) return [];

    const config = ctx.getModuleConfig<GitHubWebhookConfig>();
    const enabledEvents = new Set(config?.events ?? DEFAULT_EVENTS);

    return [
      {
        method: "POST",
        path: "/api/webhooks/github",
        bypassAuth: true,
        handler: makeWebhookHandler(secret, enabledEvents, ctx),
      },
    ];
  },

  onLoad: (ctx: ModuleContext) => {
    const config = ctx.getModuleConfig<GitHubWebhookConfig>();
    if (!config?.secret) {
      ctx.log.warn(
        "github-webhook: no secret configured — webhook route not registered",
      );
      return;
    }
    const secret = resolveSecret(config.secret);
    if (!secret) {
      ctx.log.warn(
        "github-webhook: secret env var is unset — webhook route not registered",
      );
    }
  },
};

export default githubWebhookModule;
