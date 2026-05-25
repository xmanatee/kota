/**
 * GitHub webhook module — receives GitHub webhook deliveries and emits typed bus events.
 *
 * Registers `POST /api/webhooks/github` and validates each delivery's HMAC-SHA256
 * signature before emitting normalized bus events. Generic GitHub deliveries use
 * `github.<event>` events; configured issue-comment mentions use the shared
 * project-scoped `inbound.signal.received` contract.
 *
 * Config (under modules.github-webhook):
 *   secret:  Webhook secret or "$ENV_VAR" reference. Required.
 *   events:  Event types to accept. Default: ["push", "pull_request", "check_run"].
 *   issueComment.mentionAliases: Mention aliases that trigger typed comment events.
 *
 * Invalid signatures are rejected with HTTP 401 and a warning log.
 * Unrecognised/unconfigured event types return HTTP 200 with `ignored: true`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { deriveProjectId } from "#core/daemon/project-registry.js";
import type {
  KotaModule,
  ModuleContext,
  ModuleRuntimeContext,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import {
  type GitHubIssueCommentMentionEventPayload,
  type GitHubPullRequestEventPayload,
  type GitHubWebhookActor,
  type GitHubWebhookActorIntegrity,
  githubPullRequestEvent,
} from "./events.js";
import { githubIssueCommentMentionToInboundSignal } from "./inbound-signal.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type GitHubWebhookConfig = {
  /** Webhook secret or "$ENV_VAR" reference. Required. */
  secret: string;
  /** Event types to accept. Default: ["push", "pull_request", "check_run"]. */
  events?: readonly string[];
  issueComment?: {
    /** GitHub mention tokens that should trigger the typed comment event. Defaults to @kota. */
    mentionAliases?: readonly string[];
    /** Comment actions that can trigger mention handling. Defaults to created. */
    supportedActions?: readonly string[];
  };
  actorIntegrity?: {
    /** Author associations trusted for autonomous review. Defaults to OWNER, MEMBER, COLLABORATOR. */
    trustedAuthorAssociations?: readonly string[];
    /** GitHub logins that should never trigger autonomous review. Case-insensitive. */
    blockedActors?: readonly string[];
  };
};

const DEFAULT_EVENTS = ["push", "pull_request", "check_run"];
const DEFAULT_ISSUE_COMMENT_MENTION_ALIASES = ["@kota"];
const DEFAULT_ISSUE_COMMENT_SUPPORTED_ACTIONS = ["created"];
const DEFAULT_TRUSTED_AUTHOR_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

type JsonObject = { [key: string]: unknown };
type JsonMember = JsonObject[string];

type ActorIntegrityConfig = NonNullable<GitHubWebhookConfig["actorIntegrity"]>;
type IssueCommentConfig = NonNullable<GitHubWebhookConfig["issueComment"]>;

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

function objectValue(value: JsonMember): JsonObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function stringValue(value: JsonMember): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: JsonMember): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: JsonMember): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function actorValue(value: JsonMember): GitHubWebhookActor {
  const actor = objectValue(value);
  return {
    login: actor ? stringValue(actor.login) : null,
    type: actor ? stringValue(actor.type) : null,
  };
}

function normalizeActorLogin(login: string): string {
  return login.trim().toLowerCase();
}

function actorIntegrityConfigSets(config: ActorIntegrityConfig | undefined): {
  blockedActors: ReadonlySet<string>;
  trustedAssociations: ReadonlySet<string>;
} {
  return {
    blockedActors: new Set(
      (config?.blockedActors ?? [])
        .map(normalizeActorLogin)
        .filter((login) => login.length > 0),
    ),
    trustedAssociations: new Set(
      (config?.trustedAuthorAssociations ?? DEFAULT_TRUSTED_AUTHOR_ASSOCIATIONS)
        .map((association) => association.trim().toUpperCase())
        .filter((association) => association.length > 0),
    ),
  };
}

function deriveActorIntegrity(input: {
  sender: GitHubWebhookActor;
  prAuthor: GitHubWebhookActor;
  authorAssociation: string | null;
  headSha: string | null;
  config?: ActorIntegrityConfig;
}): {
  actorIntegrity: GitHubWebhookActorIntegrity;
  actorIntegrityReason: string;
} {
  const { blockedActors, trustedAssociations } = actorIntegrityConfigSets(input.config);
  const blockedActor = [input.sender.login, input.prAuthor.login].find(
    (login) => login !== null && blockedActors.has(normalizeActorLogin(login)),
  );
  if (blockedActor) {
    return {
      actorIntegrity: "blocked_actor",
      actorIntegrityReason: `blocked actor '${blockedActor}' matched github-webhook actorIntegrity.blockedActors`,
    };
  }

  const missing: string[] = [];
  if (!input.sender.login) missing.push("sender.login");
  if (!input.sender.type) missing.push("sender.type");
  if (!input.prAuthor.login) missing.push("pull_request.user.login");
  if (!input.prAuthor.type) missing.push("pull_request.user.type");
  if (!input.authorAssociation) missing.push("pull_request.author_association");
  if (!input.headSha) missing.push("pull_request.head.sha");
  if (missing.length > 0) {
    return {
      actorIntegrity: "missing_metadata",
      actorIntegrityReason: `missing actor trust metadata: ${missing.join(", ")}`,
    };
  }

  const authorAssociation = input.authorAssociation;
  if (authorAssociation === null) {
    throw new Error("authorAssociation must be present after missing metadata check");
  }
  const association = authorAssociation.toUpperCase();
  if (!trustedAssociations.has(association)) {
    return {
      actorIntegrity: "low_trust_actor",
      actorIntegrityReason: `author association '${authorAssociation}' is below the configured trust threshold`,
    };
  }

  return {
    actorIntegrity: "allowed",
    actorIntegrityReason: `author association '${authorAssociation}' satisfies the configured trust threshold`,
  };
}

function issueCommentConfigValues(config: IssueCommentConfig | undefined): {
  mentionAliases: readonly string[];
  supportedActions: ReadonlySet<string>;
} {
  return {
    mentionAliases: (config?.mentionAliases ?? DEFAULT_ISSUE_COMMENT_MENTION_ALIASES)
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0),
    supportedActions: new Set(
      (config?.supportedActions ?? DEFAULT_ISSUE_COMMENT_SUPPORTED_ACTIONS)
        .map((action) => action.trim().toLowerCase())
        .filter((action) => action.length > 0),
    ),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMentionAlias(body: string | null, aliases: readonly string[]): string | null {
  if (!body) return null;
  for (const alias of aliases) {
    const pattern = new RegExp(
      `(^|[^A-Za-z0-9_@-])${escapeRegExp(alias)}(?=$|[^A-Za-z0-9_-])`,
      "i",
    );
    if (pattern.test(body)) return alias;
  }
  return null;
}

function deriveIssueCommentActorIntegrity(input: {
  sender: GitHubWebhookActor;
  commenter: GitHubWebhookActor;
  authorAssociation: string | null;
  config?: ActorIntegrityConfig;
}): {
  actorIntegrity: GitHubWebhookActorIntegrity;
  actorIntegrityReason: string;
} {
  const { blockedActors, trustedAssociations } = actorIntegrityConfigSets(input.config);
  const blockedActor = [input.sender.login, input.commenter.login].find(
    (login) => login !== null && blockedActors.has(normalizeActorLogin(login)),
  );
  if (blockedActor) {
    return {
      actorIntegrity: "blocked_actor",
      actorIntegrityReason: `blocked actor '${blockedActor}' matched github-webhook actorIntegrity.blockedActors`,
    };
  }

  const missing: string[] = [];
  if (!input.sender.login) missing.push("sender.login");
  if (!input.sender.type) missing.push("sender.type");
  if (!input.commenter.login) missing.push("comment.user.login");
  if (!input.commenter.type) missing.push("comment.user.type");
  if (!input.authorAssociation) missing.push("comment.author_association");
  if (missing.length > 0) {
    return {
      actorIntegrity: "missing_metadata",
      actorIntegrityReason: `missing actor trust metadata: ${missing.join(", ")}`,
    };
  }

  const authorAssociation = input.authorAssociation;
  if (authorAssociation === null) {
    throw new Error("authorAssociation must be present after missing metadata check");
  }
  const association = authorAssociation.toUpperCase();
  if (!trustedAssociations.has(association)) {
    return {
      actorIntegrity: "low_trust_actor",
      actorIntegrityReason: `author association '${authorAssociation}' is below the configured trust threshold`,
    };
  }

  return {
    actorIntegrity: "allowed",
    actorIntegrityReason: `author association '${authorAssociation}' satisfies the configured trust threshold`,
  };
}

function normalizePullRequestPayload(
  raw: JsonObject,
  actorIntegrityConfig: ActorIntegrityConfig | undefined,
): GitHubPullRequestEventPayload {
  const repository = objectValue(raw.repository);
  const repo = repository ? stringValue(repository.full_name) : null;
  const pr = objectValue(raw.pull_request);
  const head = pr ? objectValue(pr.head) : null;
  const base = pr ? objectValue(pr.base) : null;
  const headRepoObject = head ? objectValue(head.repo) : null;
  const headRepo = headRepoObject ? stringValue(headRepoObject.full_name) : null;
  const sender = actorValue(raw.sender);
  const prAuthor = actorValue(pr ? pr.user : null);
  const authorAssociation = pr ? stringValue(pr.author_association) : null;
  const headSha = head ? stringValue(head.sha) : null;
  const integrity = deriveActorIntegrity({
    sender,
    prAuthor,
    authorAssociation,
    headSha,
    config: actorIntegrityConfig,
  });

  return {
    repo,
    action: stringValue(raw.action),
    number: numberValue(raw.number),
    title: pr ? stringValue(pr.title) : null,
    state: pr ? stringValue(pr.state) : null,
    merged: pr ? booleanValue(pr.merged) : null,
    headBranch: head ? stringValue(head.ref) : null,
    baseBranch: base ? stringValue(base.ref) : null,
    headRepo,
    isFork: headRepo !== null && repo !== null ? headRepo !== repo : null,
    headSha,
    sender,
    prAuthor,
    authorAssociation,
    actorIntegrity: integrity.actorIntegrity,
    actorIntegrityReason: integrity.actorIntegrityReason,
  };
}

type IssueCommentMentionDecision =
  | {
      kind: "emit";
      payload: GitHubIssueCommentMentionEventPayload;
    }
  | {
      kind: "ignore";
      reason: "unsupported_action" | "no_matching_mention";
      repo: string | null;
      action: string | null;
    };

function normalizeIssueCommentMentionDelivery(
  raw: JsonObject,
  issueCommentConfig: IssueCommentConfig | undefined,
  actorIntegrityConfig: ActorIntegrityConfig | undefined,
): IssueCommentMentionDecision {
  const repository = objectValue(raw.repository);
  const repo = repository ? stringValue(repository.full_name) : null;
  const action = stringValue(raw.action);
  const { mentionAliases, supportedActions } = issueCommentConfigValues(issueCommentConfig);
  if (action === null || !supportedActions.has(action.toLowerCase())) {
    return { kind: "ignore", reason: "unsupported_action", repo, action };
  }

  const comment = objectValue(raw.comment);
  const issue = objectValue(raw.issue);
  const body = comment ? stringValue(comment.body) : null;
  const matchedMentionAlias = findMentionAlias(body, mentionAliases);
  if (!matchedMentionAlias) {
    return { kind: "ignore", reason: "no_matching_mention", repo, action };
  }

  const sender = actorValue(raw.sender);
  const commenter = actorValue(comment ? comment.user : null);
  const authorAssociation = comment ? stringValue(comment.author_association) : null;
  const integrity = deriveIssueCommentActorIntegrity({
    sender,
    commenter,
    authorAssociation,
    config: actorIntegrityConfig,
  });

  return {
    kind: "emit",
    payload: {
      repo,
      repositoryId: repository ? numberValue(repository.id) : null,
      repositoryUrl: repository ? stringValue(repository.html_url) : null,
      action,
      issueNumber: issue ? numberValue(issue.number) : null,
      issueTitle: issue ? stringValue(issue.title) : null,
      issueUrl: issue ? stringValue(issue.html_url) : null,
      isPullRequest: issue ? objectValue(issue.pull_request) !== null : false,
      commentId: comment ? numberValue(comment.id) : null,
      commentBody: body,
      commentUrl: comment ? stringValue(comment.html_url) : null,
      commenter,
      sender,
      authorAssociation,
      matchedMentionAlias,
      actorIntegrity: integrity.actorIntegrity,
      actorIntegrityReason: integrity.actorIntegrityReason,
      reason: `comment body mentioned configured alias '${matchedMentionAlias}'`,
    },
  };
}

function normalizePayload(
  eventType: string,
  raw: JsonObject,
): JsonObject {
  const repository = objectValue(raw.repository);
  const repo = repository ? stringValue(repository.full_name) : null;

  if (eventType === "push") {
    const ref = typeof raw.ref === "string" ? raw.ref : null;
    return {
      repo,
      ref,
      branch: ref ? ref.replace("refs/heads/", "") : null,
      commits: Array.isArray(raw.commits) ? raw.commits.length : 0,
      pusher: stringValue(objectValue(raw.pusher)?.name),
    };
  }

  if (eventType === "check_run") {
    const checkRun = objectValue(raw.check_run);
    return {
      repo,
      action: stringValue(raw.action),
      name: checkRun ? stringValue(checkRun.name) : null,
      status: checkRun ? stringValue(checkRun.status) : null,
      conclusion: checkRun ? stringValue(checkRun.conclusion) : null,
    };
  }

  return { repo };
}

// ─── Route handler factory ────────────────────────────────────────────────────

function makeWebhookHandler(
  secret: string,
  enabledEvents: Set<string>,
  issueCommentConfig: IssueCommentConfig | undefined,
  actorIntegrityConfig: ActorIntegrityConfig | undefined,
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

    let rawPayload: JsonObject;
    try {
      rawPayload = body.length ? (JSON.parse(body.toString("utf-8")) as JsonObject) : {};
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    if (eventType === "issue_comment") {
      const decision = normalizeIssueCommentMentionDelivery(
        rawPayload,
        issueCommentConfig,
        actorIntegrityConfig,
      );
      if (decision.kind === "ignore") {
        ctx.log.info(`github-webhook: ignored github.issue_comment`, {
          repo: decision.repo,
          action: decision.action,
          reason: decision.reason,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            ignored: true,
            event: "issue_comment",
            reason: decision.reason,
          }),
        );
        return;
      }

      const receivedAt = new Date().toISOString();
      const comment = objectValue(rawPayload.comment);
      const occurredAt = comment ? stringValue(comment.created_at) ?? receivedAt : receivedAt;
      const inboundSignal = githubIssueCommentMentionToInboundSignal(
        decision.payload,
        {
          projectId: deriveProjectId(ctx.cwd),
          occurredAt,
          receivedAt,
        },
      );
      if (!inboundSignal.ok) {
        ctx.log.warn(
          `github-webhook: skipped inbound signal normalization: ${inboundSignal.error}`,
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            ignored: true,
            event: inboundSignalReceived.name,
            reason: "invalid_inbound_signal",
          }),
        );
        return;
      }
      ctx.events.emit(inboundSignalReceived, inboundSignal.payload);
      ctx.log.info("github-webhook: emitted inbound.signal.received", {
        repo: decision.payload.repo,
        actorIntegrity: decision.payload.actorIntegrity,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, event: inboundSignalReceived.name }));
      return;
    }

    const payload =
      eventType === "pull_request"
        ? normalizePullRequestPayload(rawPayload, actorIntegrityConfig)
        : normalizePayload(eventType, rawPayload);
    if (eventType === "pull_request") {
      ctx.events.emit(githubPullRequestEvent, payload as GitHubPullRequestEventPayload);
    } else {
      ctx.events.emitExternal(`github.${eventType}`, payload);
    }
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
    "GitHub webhook receiver — validates HMAC signatures and emits typed GitHub and inbound-signal events",
  dependencies: ["inbound-signals"],
  events: [githubPullRequestEvent],

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
        handler: makeWebhookHandler(
          secret,
          enabledEvents,
          config?.issueComment,
          config?.actorIntegrity,
          ctx,
        ),
      },
    ];
  },

  onLoad: (ctx: ModuleRuntimeContext) => {
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
