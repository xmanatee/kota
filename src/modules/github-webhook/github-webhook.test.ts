import { createHmac } from "node:crypto";
import { once } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { type BusEnvelope, EventBus } from "#core/events/event-bus.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { buildRequestHandler } from "#core/server/server-routes.js";
import { SessionPool } from "#core/server/session-pool.js";
import { inboundSignalReceived } from "#modules/inbound-signals/events.js";
import githubWebhookModule from "./index.js";

const SECRET = "test-webhook-secret";
const repository = { id: 99, full_name: "owner/repo", html_url: "https://github.com/owner/repo" };
const actor = { login: "maintainer", type: "User" };
afterEach(() => vi.unstubAllEnvs());

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function comment() {
  return {
    action: "created", repository, sender: { ...actor },
    issue: { number: 17, title: "Help", html_url: `${repository.html_url}/issues/17`, pull_request: {} },
    comment: {
      id: 1234, body: "@kota please look", created_at: "2026-05-25T02:40:00.000Z",
      html_url: `${repository.html_url}/issues/17#issuecomment-1234`,
      user: { ...actor }, author_association: "MEMBER",
    },
  };
}

function pullRequest() {
  return {
    action: "opened", number: 42, repository, sender: { ...actor },
    pull_request: {
      title: "Fix bug", state: "open", merged: false,
      user: { login: "kota-bot", type: "Bot" }, author_association: "MEMBER",
      head: { ref: "feature", sha: "abc123", repo: { full_name: "owner/repo" } },
      base: { ref: "main" },
    },
  };
}

async function receiver(config: unknown = { secret: SECRET }) {
  const bus = new EventBus();
  const emitted: BusEnvelope[] = [];
  bus.on("*", (event) => emitted.push(event));
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: Parameters<typeof githubWebhookModule.routes>[0] = {
    cwd: "/tmp", getModuleConfig: <T>() => config as T,
    events: makeStubEventProxy(bus), log,
  };
  githubWebhookModule.onLoad(ctx);
  const handle = buildRequestHandler({
    port: 0, pool: new SessionPool(), bus,
    moduleRoutes: githubWebhookModule.routes(ctx), authToken: "daemon-token",
    makeAgent: () => { throw new Error("Webhook must not create a session"); },
    resolveDefaultAutonomyMode: () => "passive",
  });
  return {
    emitted, log,
    async deliver(event: string | null, payload: unknown, signature?: string | null) {
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      const headers: Record<string, string> = {};
      if (event !== null) headers["x-github-event"] = event;
      if (signature !== null) headers["x-hub-signature-256"] = signature ?? sign(body);
      // Only the byte transport is controlled; routing and Node HTTP remain real.
      const wire: Buffer[] = [];
      const socket = new Socket();
      socket._write = (chunk, _encoding, callback) => { wire.push(Buffer.from(chunk)); callback(); };
      socket._writev = (entries, callback) => {
        wire.push(...entries.map(({ chunk }) => Buffer.from(chunk))); callback();
      };
      const request = new IncomingMessage(socket);
      request.method = "POST";
      request.url = "/api/webhooks/github";
      request.headers = headers;
      request.complete = true;
      request.httpVersionMajor = 1;
      request.httpVersionMinor = 0;
      const response = new ServerResponse(request);
      response.assignSocket(socket);
      const finished = once(response, "finish");
      try {
        handle(request, response);
        request.push(Buffer.from(body));
        request.push(null);
        await finished;
        const output = Buffer.concat(wire).toString();
        return { status: response.statusCode, body: JSON.parse(output.slice(output.indexOf("\r\n\r\n") + 4)) };
      } finally {
        socket.destroy();
      }
    },
  };
}

describe("GitHub webhook delivery", () => {
  it.each([
    [undefined, "no secret"],
    [{ secret: "$KOTA_TEST_WEBHOOK_SECRET" }, "unset"],
  ])("keeps an unconfigured receiver authenticated: %j", async (config, diagnostic) => {
    vi.stubEnv("KOTA_TEST_WEBHOOK_SECRET", undefined);
    const host = await receiver(config ?? {});
    expect(await host.deliver("push", {})).toMatchObject({ status: 401 });
    expect(host.emitted).toEqual([]);
    expect(host.log.warn).toHaveBeenCalledWith(expect.stringContaining(diagnostic));
  });

  it("resolves a configured environment secret for real delivery without daemon credentials", async () => {
    vi.stubEnv("KOTA_TEST_WEBHOOK_SECRET", SECRET);
    const host = await receiver({ secret: "$KOTA_TEST_WEBHOOK_SECRET" });
    expect(await host.deliver("push", {})).toMatchObject({ status: 200 });
    expect(host.emitted.map((event) => event.type)).toEqual(["github.push"]);
    expect(host.log.warn).not.toHaveBeenCalled();
  });

  it.each([
    ["missing signature", "push", null, 401],
    ["wrong algorithm", "push", "sha1=abc", 401],
    ["truncated signature", "push", "sha256=abc", 401],
    ["changed body", "push", sign('{"other":true}'), 401],
    ["wrong secret", "push", sign("{}", "other-secret"), 401],
    ["missing event", null, sign("{}"), 400],
  ])("rejects %s before emitting", async (_name, event, signature, status) => {
    const host = await receiver();
    expect(await host.deliver(event, {}, signature)).toMatchObject({ status });
    expect(host.emitted).toEqual([]);
  });

  it.each(["{", "null", "[]", '"text"', "1", "true"])(
    "rejects signed non-object JSON %s without events", async (body) => {
      const host = await receiver();
      expect(await host.deliver("push", body)).toMatchObject({ status: 400 });
      expect(host.emitted).toEqual([]);
    },
  );

  it.each([
    ["push", { secret: SECRET, events: ["pull_request"] }],
    ["issue_comment", { secret: SECRET }],
  ])("acknowledges disabled %s without emission", async (event, config) => {
    const host = await receiver(config);
    expect(await host.deliver(event, comment())).toEqual({
      status: 200, body: { ok: true, ignored: true, event },
    });
    expect(host.emitted).toEqual([]);
  });

  it.each([
    ["push", { repository, ref: "refs/heads/main", commits: [{}, {}], pusher: { name: "alice" } },
      { repo: "owner/repo", ref: "refs/heads/main", branch: "main", commits: 2, pusher: "alice" }],
    ["check_run", { repository, action: "completed", check_run: { name: "CI", status: "completed", conclusion: "success" } },
      { repo: "owner/repo", action: "completed", name: "CI", status: "completed", conclusion: "success" }],
    ["pull_request", pullRequest(), {
      repo: "owner/repo", action: "opened", number: 42, title: "Fix bug", state: "open", merged: false,
      headBranch: "feature", baseBranch: "main", headRepo: "owner/repo", isFork: false, headSha: "abc123",
      sender: actor, prAuthor: { login: "kota-bot", type: "Bot" }, authorAssociation: "MEMBER",
      actorIntegrity: "allowed", actorIntegrityReason: expect.stringContaining("satisfies"),
    }],
  ])("normalizes %s once through its enabled route", async (event, body, payload) => {
    const host = await receiver();
    expect(await host.deliver(event, body)).toEqual({ status: 200, body: { ok: true, event: `github.${event}` } });
    expect(host.emitted).toMatchObject([{ type: `github.${event}`, payload }]);
    expect(host.emitted).toHaveLength(1);
  });

  it.each([
    [{ full_name: "contributor/repo" }, "contributor/repo", true],
    [null, null, null],
  ])("preserves fork uncertainty: %j", async (repo, headRepo, isFork) => {
    const host = await receiver();
    const body = pullRequest();
    await host.deliver("pull_request", { ...body, pull_request: { ...body.pull_request, head: { ...body.pull_request.head, repo } } });
    expect(host.emitted).toMatchObject([{ payload: { headRepo, isFork } }]);
  });

  for (const event of ["pull_request", "issue_comment"] as const) {
    it.each([
      ["allowed", "MEMBER", "maintainer", "User", {}, "satisfies"],
      ["missing_metadata", "MEMBER", "", "", {}, "sender.login"],
      ["low_trust_actor", "FIRST_TIMER", "maintainer", "User", {}, "below"],
      ["blocked_actor", "MEMBER", "blocked-user", "User", { blockedActors: ["BLOCKED-USER"] }, "blocked actor"],
      ["blocked_actor", "", "blocked-user", "", { blockedActors: ["BLOCKED-USER"] }, "blocked actor"],
      ["allowed", "FIRST_TIMER", "maintainer", "User", { trustedAuthorAssociations: ["first_timer"] }, "satisfies"],
      ["low_trust_actor", "MEMBER", "maintainer", "User", { trustedAuthorAssociations: [] }, "below"],
    ])(`${event} derives %s for association %s and actor %s/%s with %j`, async (integrity, association, login, type, policy, reason) => {
      const host = await receiver({ secret: SECRET, events: [event], actorIntegrity: policy });
      const person = { login, type };
      const pr = pullRequest();
      const mention = comment();
      const body = event === "pull_request"
        ? { ...pr, sender: person, pull_request: { ...pr.pull_request, user: person, author_association: association } }
        : { ...mention, sender: person, comment: { ...mention.comment, user: person, author_association: association } };
      expect(await host.deliver(event, body)).toMatchObject({ status: 200 });
      const decision = { actorIntegrity: integrity, actorIntegrityReason: expect.stringContaining(reason) };
      const payload = event === "pull_request" ? decision : {
        actor: { trust: integrity === "allowed" ? "trusted" : integrity === "blocked_actor" ? "blocked" : "untrusted" },
        body: { data: decision },
      };
      expect(host.emitted).toHaveLength(1);
      expect(host.emitted[0]).toMatchObject({ payload });
    });
  }

  for (const event of ["pull_request", "issue_comment"] as const) {
    it.each(["sender.login", "sender.type", "author.login", "author.type", "association"])(
      `${event} requires %s independently`, async (field) => {
        const host = await receiver({ secret: SECRET, events: [event] });
        const body = event === "pull_request" ? pullRequest() : comment();
        const subject = "pull_request" in body ? body.pull_request : body.comment;
        if (field === "association") subject.author_association = "";
        else {
          const person = field.startsWith("sender") ? body.sender : subject.user;
          if (field.endsWith("login")) person.login = "";
          else person.type = "";
        }
        await host.deliver(event, body);
        const decision = { actorIntegrity: "missing_metadata" };
        expect(host.emitted).toMatchObject([{ payload: event === "pull_request" ? decision : {
          actor: { trust: "untrusted" }, body: { data: decision },
        } }]);
      },
    );
    it.each(["sender", "author"])(`${event} blocks %s independently`, async (role) => {
      const host = await receiver({ secret: SECRET, events: [event], actorIntegrity: { blockedActors: ["blocked"] } });
      const body = event === "pull_request" ? pullRequest() : comment();
      const subject = "pull_request" in body ? body.pull_request : body.comment;
      (role === "sender" ? body.sender : subject.user).login = "BLOCKED";
      await host.deliver(event, body);
      const decision = { actorIntegrity: "blocked_actor" };
      expect(host.emitted).toMatchObject([{ payload: event === "pull_request" ? decision : {
        actor: { trust: "blocked" }, body: { data: decision },
      } }]);
    });
  }

  it("requires PR head provenance even when actor metadata is trusted", async () => {
    const host = await receiver();
    const body = pullRequest();
    body.pull_request.head.sha = "";
    await host.deliver("pull_request", body);
    expect(host.emitted).toMatchObject([{ payload: {
      actorIntegrity: "missing_metadata", actorIntegrityReason: expect.stringContaining("pull_request.head.sha"),
    } }]);
  });

  it("emits a scoped mention with stable source identity and normalized trust", async () => {
    const host = await receiver({ secret: SECRET, events: ["issue_comment"] });
    const body = comment();
    body.comment.body = "Could @KOTA review this issue?";
    expect(await host.deliver("issue_comment", body)).toEqual({
      status: 200, body: { ok: true, event: inboundSignalReceived.name },
    });
    expect(host.emitted).toHaveLength(1);
    expect(host.emitted[0]).toMatchObject({ type: inboundSignalReceived.name, payload: {
      scopeId: deriveDirectoryScopeId("/tmp"), provider: "github", channel: "github.issue_comment",
      accountId: "github:owner/repo", sourceId: "github:owner/repo:issue:17:comment:1234",
      sourceUrl: body.comment.html_url, externalId: "github:99:issue_comment:1234",
      occurredAt: body.comment.created_at,
      actor: { id: "github:maintainer", displayName: "maintainer", trust: "trusted" },
      body: { kind: "action", action: "github.issue_comment.mention", data: {
        repo: "owner/repo", repositoryId: 99, repositoryUrl: repository.html_url, action: "created",
        issueNumber: 17, issueTitle: "Help", issueUrl: body.issue.html_url, isPullRequest: true,
        commentId: 1234, commentBody: body.comment.body, commentUrl: body.comment.html_url,
        commenter: actor, sender: actor, authorAssociation: "MEMBER", matchedMentionAlias: "@kota",
        actorIntegrity: "allowed", actorIntegrityReason: expect.stringContaining("satisfies"),
      } },
    } });
  });

  it.each([
    ["@kota-bot is different", "created", "no_matching_mention"],
    ["@kota please look", "edited", "unsupported_action"],
  ])("ignores comment %s / %s", async (text, action, reason) => {
    const host = await receiver({ secret: SECRET, events: ["issue_comment"] });
    const body = comment();
    body.comment.body = text;
    body.action = action;
    expect(await host.deliver("issue_comment", body)).toMatchObject({ status: 200, body: { ignored: true, reason } });
    expect(host.emitted).toEqual([]);
  });

  it("applies configured mention aliases and actions to issue comments", async () => {
    const host = await receiver({ secret: SECRET, events: ["issue_comment"], issueComment: {
      mentionAliases: ["@helper"], supportedActions: ["edited"],
    } });
    const body = comment();
    body.action = "edited";
    body.comment.body = "(@HELPER) please look";
    await host.deliver("issue_comment", { ...body, issue: { ...body.issue, pull_request: null } });
    expect(host.emitted).toMatchObject([{ payload: { body: { data: { matchedMentionAlias: "@helper", isPullRequest: false } } } }]);
  });

  it("does not emit an unidentifiable mention", async () => {
    const host = await receiver({ secret: SECRET, events: ["issue_comment"] });
    const body = comment();
    expect(await host.deliver("issue_comment", { ...body, repository: {} })).toMatchObject({
      status: 200, body: { ignored: true, reason: "invalid_inbound_signal" },
    });
    expect(host.emitted).toEqual([]);
  });
});
