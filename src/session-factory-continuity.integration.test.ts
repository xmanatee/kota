import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { KotaMessageStream, KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import { agentConversationRoot, resetAgentConversation } from "#core/agent-harness/session-continuity.js";
import { createDaemonAgentSessionFactories } from "#core/daemon/daemon-agent-session-factory.js";
import { ScopeRegistry } from "#core/daemon/scope-registry.js";
import { ScopeRuntimeRegistry } from "#core/daemon/scope-runtime.js";
import { EventBus } from "#core/events/event-bus.js";
import { AgentSession } from "#core/loop/loop.js";
import { NullTransport } from "#core/loop/transport.js";
import { type MessageStreamParams, registerModelClientFactory } from "#core/model/model-client.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { createHttpAgentSession } from "#core/server/server.js";
import { SessionPool } from "#core/server/session-pool.js";
import { type HttpAgentFactory, handleChat, handleCreateSession } from "#core/server/session-routes.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { ConversationHistory } from "#modules/history/history.js";
import { createSlackChannelSession } from "#modules/slack-channel/bot-sessions.js";
import vercelAdapter from "#modules/vercel-adapter/index.js";
import { clearSessions, makeWebhookChannelHandler } from "#modules/webhook-channel/handler.js";
import { createAgentSession as createWebhookSession } from "#modules/webhook-channel/sessions.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kota-session-factories-"));
  const stateDir = join(root, ".kota");
  const otherRoot = join(root, "other-scope");
  mkdirSync(otherRoot);
  const registry = new ScopeRegistry({ stateDir, scopes: [{ scopeRoot: root }, { scopeRoot: otherRoot }] });
  const runState = new RunStateDatabase(stateDir);
  const createdAt = new Date().toISOString();
  for (const scope of registry.list()) runState.registerScope({ id: scope.scopeId, rootPath: scope.scopeRoot, displayName: scope.displayName, createdAt });
  const daemonEpoch = runState.beginDaemonSession(createdAt).epoch;
  const bus = new EventBus();
  const runCoordinator = new RunCoordinator({
    store: runState, daemonEpoch, concurrency: 1,
    execute: (run, signal) => runtimes.getDefault().workflowRuntime.executeAdmittedRun(run, signal),
  });
  const runtimes = ScopeRuntimeRegistry.create({ registry, bus, onLog: () => {}, runState, runCoordinator, daemonEpoch });
  const runtime = runtimes.getDefault();
  const loader = new ModuleLoader({ model: "openai/controlled", serve: { defaultAutonomyMode: "supervised" } });
  loader.setCwd(root);
  loader.setBus(bus);
  const history = new ConversationHistory(join(root, ".kota", "history"));
  const snapshots: MessageStreamParams[] = [];
  let fail = false;
  const response = (): KotaModelResponse => {
    if (fail) throw new Error("authentication unavailable");
    return { id: "controlled", role: "assistant", model: "controlled", content: [{ type: "text", text: "Saved reply" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  };
  registerModelClientFactory(({ model }) => ({
    model: model ?? "openai/controlled", providerName: "openai",
    client: { messages: {
      create: async () => response(),
      stream(params): KotaMessageStream {
        snapshots.push(structuredClone({ ...params, signal: undefined }));
        return { on() { return this; }, async finalMessage() { return response(); } };
      },
    } },
  }));
  const factories = createDaemonAgentSessionFactories({
    model: "openai/controlled", config: { serve: { defaultAutonomyMode: "supervised" } },
    runtimeModuleHost: { eventBus: bus, moduleLoader: loader },
  }, runtimes, () => history);
  loader.setSessionFactory(factories.createModuleSession);
  const sessions: AgentSession[] = [];
  return {
    root, runtime, runtimes, loader, factories, history,
    fail(value: boolean) { fail = value; },
    messages: () => JSON.stringify(snapshots.at(-1)?.messages),
    system: () => JSON.stringify(snapshots.at(-1)?.system),
    track(session: AgentSession) { sessions.push(session); return session; },
    async close() {
      await Promise.all(sessions.map((session) => session.dispose()));
      await loader.unloadAll();
      for (const scoped of runtimes.list()) {
        scoped.scheduler.stopTimer();
        scoped.scheduler.disconnectBus();
        await scoped.workflowRuntime.stop();
      }
      runState.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Detect channel routing that bypasses the real AgentSession/store composition.
it("recovers Slack replacements and isolates workspace, user and scope", async () => {
  const f = fixture();
  const slack = (user = "U1", workspace = "T1", runtime = f.runtime) => f.track(createSlackChannelSession({
    autonomyMode: "supervised", model: "openai/controlled", workspaceId: workspace,
    moduleLoader: f.loader,
  }, user, runtime).agent);
  try {
    const first = slack();
    await first.send("Remember cobalt maple");
    await first.dispose();
    writeFileSync(join(f.root, "AGENTS.md"), "Use the current violet policy.\n");
    const replacement = slack();
    await replacement.send("Recall the phrase");
    expect(f.messages()).toContain("cobalt maple");
    expect(f.messages()).toContain("Saved reply");
    expect(f.system()).toContain("current violet policy");
    await slack("U2").send("Another user");
    expect(f.messages()).not.toContain("cobalt maple");
    await slack("U1", "T2").send("Another workspace");
    expect(f.messages()).not.toContain("cobalt maple");
    await slack("U1", "T1", f.runtimes.list()[1]).send("Another scope");
    expect(f.messages()).not.toContain("cobalt maple");
  } finally { await f.close(); }
});

// Detect daemon wake loading only periodic history and losing a pre-effect checkpoint.
it("seeds daemon history once, recovers an interrupted request, and honors an explicit reset", async () => {
  const f = fixture();
  try {
    const id = f.history.create("openai/controlled", f.root);
    f.history.save(id, [{ role: "user", content: "Legacy amber phrase" }], 2, 10);
    const session = () => f.track(f.factories.makeAgentSession(new NullTransport(), "supervised", f.runtime.scope.scopeId, { resumeConversation: id, noHistory: true }));
    const first = session();
    await first.send("Continue the legacy conversation");
    expect(f.messages()).toContain("Legacy amber phrase");
    f.fail(true);
    await expect(first.send("Retain this interrupted request")).rejects.toThrow("authentication unavailable");
    await first.dispose();
    f.fail(false);
    const replacement = session();
    await replacement.send("Recover");
    expect(f.messages()).toContain("Retain this interrupted request");
    expect(f.messages()).toContain("Saved reply");
    expect(f.messages().match(/Legacy amber phrase/g)).toHaveLength(1);
    await replacement.dispose();
    resetAgentConversation(f.root, `history:${id}`, "Operator reset the conversation.");
    await session().send("Fresh start");
    expect(f.messages()).not.toContain("Legacy amber phrase");
    expect(f.messages()).not.toContain("Retain this interrupted request");
  } finally { await f.close(); }
});

// Detect generated history IDs forking ownership and losing newer durable checkpoints.
it.each([undefined, "channel:owned-work"])("resumes generated history under its original owner (%s)", async (continuityKey) => {
  const f = fixture();
  try {
    const first = f.track(f.factories.makeAgentSession(new NullTransport(), "supervised", f.runtime.scope.scopeId, { continuityKey }));
    await first.send("Remember indigo birch");
    const id = first.getConversationId();
    if (id === null) throw new Error("Expected a generated history conversation");
    f.fail(true);
    await expect(first.send("Keep the interrupted second request")).rejects.toThrow("authentication unavailable");
    // Do not close the source: close saves history and would hide the stale-snapshot defect.
    expect(JSON.stringify(f.history.load(id)?.messages)).not.toContain("interrupted second request");
    f.fail(false);
    const resume = () => f.track(f.factories.makeAgentSession(new NullTransport(), "supervised", f.runtime.scope.scopeId, { resumeConversation: id, noHistory: true }));
    const replacement = resume();
    await replacement.send("Recover the conversation");
    expect(f.messages()).toContain("indigo birch");
    expect(f.messages()).toContain("Saved reply");
    expect(f.messages()).toContain("Keep the interrupted second request");
    expect(replacement.continuity?.key).toBe(first.continuity?.key);
    await replacement.dispose();
    resetAgentConversation(f.root, first.continuity!.key, "Operator reset through the resumed session.");
    await resume().send("Start fresh");
    expect(f.messages()).not.toContain("indigo birch");
    expect(f.messages()).not.toContain("interrupted second request");
  } finally { await f.close(); }
});

// Detect module factories dropping work identity or merging identically named work across modules.
it("preserves unnamed sessions and recovers module-owned webhook work without crossing module ownership", async () => {
  const f = fixture();
  const contexts = new Map<string, ModuleContext>();
  try {
    for (const name of ["webhook-owner", "other-owner"]) await f.loader.load({
      name, onLoad(ctx) { contexts.set(name, ctx); },
    });
    const webhook = (owner: string) => createWebhookSession({
      ctx: contexts.get(owner)!, continuityKey: "source:work", label: "same label", autonomyMode: "supervised",
    });
    const first = webhook("webhook-owner");
    await first.send("Remember module topaz");
    first.close();
    const replacement = webhook("webhook-owner");
    await replacement.send("Recall");
    expect(f.messages()).toContain("module topaz");
    replacement.close();
    const unrelated = webhook("other-owner");
    await unrelated.send("Different owner");
    expect(f.messages()).not.toContain("module topaz");
    unrelated.close();

    const unnamed = f.track(new AgentSession({
      autonomyMode: "supervised", model: "openai/controlled", scopeRuntime: f.runtime,
      moduleLoader: f.loader, noHistory: true, transport: new NullTransport(),
    }));
    await unnamed.send("Preserve unnamed quartz");
    await unnamed.dispose();
    const saved = readdirSync(agentConversationRoot(f.root)).filter((name) => name.endsWith(".json"));
    expect(saved.some((name) => readFileSync(join(agentConversationRoot(f.root), name), "utf8").includes("unnamed quartz"))).toBe(true);
    const resumed = f.track(f.factories.makeAgentSession(new NullTransport(), "supervised", f.runtime.scope.scopeId, { continuityKey: unnamed.sessionId, noHistory: true }));
    await resumed.send("Recover that exact session");
    expect(f.messages()).toContain("unnamed quartz");
  } finally { await f.close(); }
});

// Detect request-local module sessions treating the same useChat id as new work.
it("recovers the Vercel request conversation through its route and rejects malformed identity", async () => {
  const f = fixture();
  try {
    await f.loader.load(vercelAdapter);
    const route = f.loader.getRoutes().find((route) => route.path === "/api/chat/vercel")!;
    const request = async (id: string | number, content: string) => {
      const req = new IncomingMessage(new Socket());
      const res = new ServerResponse(req);
      req.push(JSON.stringify({ id, messages: [{ role: "user", content }] }));
      req.push(null);
      await route.handler(req, res, {});
      return res.statusCode;
    };
    expect(await request("chat-one", "Remember coral birch")).toBe(200);
    expect(await request("chat-one", "Recall")).toBe(200);
    expect(f.messages()).toContain("coral birch");
    expect(await request("chat-two", "Independent conversation")).toBe(200);
    expect(f.messages()).not.toContain("coral birch");
    expect(await request(42, "Invalid identity")).toBe(400);
    expect(f.messages()).not.toContain("Invalid identity");
  } finally { await f.close(); }
});

async function httpRequest(body: object, handler: (req: IncomingMessage, res: ServerResponse) => Promise<unknown>) {
  const req = new IncomingMessage(new Socket());
  const res = new ServerResponse(req);
  const chunks: string[] = [];
  vi.spyOn(res, "write").mockImplementation((chunk) => { chunks.push(String(chunk)); return true; });
  vi.spyOn(res, "end").mockImplementation((chunk) => { if (chunk !== undefined) chunks.push(String(chunk)); return res; });
  req.push(JSON.stringify(body));
  req.push(null);
  await handler(req, res);
  return { status: res.statusCode, body: chunks.join("") };
}

// Detect a live-cache 404 bypassing the module factory's durable direct owner.
it("recovers direct webhook requests after cache replacement and rejects unknown or other-scope owners", async () => {
  const f = fixture();
  let context: ModuleContext | undefined;
  try {
    await f.loader.load({ name: "webhook-channel", onLoad(ctx) { context = ctx; } });
    const request = (body: object) => httpRequest(body, makeWebhookChannelHandler(context!, {}));
    const created = await request({ message: "Remember direct jade" });
    expect(created.status).toBe(201);
    const id = JSON.parse(created.body).sessionId;
    clearSessions();
    const resumed = await request({ sessionId: id, message: "Recall" });
    expect(resumed.status).toBe(200);
    expect(JSON.parse(resumed.body).sessionId).toBe(id);
    expect(f.messages()).toContain("direct jade");
    clearSessions();
    const other = f.runtimes.list().find((runtime) => runtime !== f.runtime)!;
    f.loader.setSessionFactory((options) => f.factories.createModuleSession({ ...options, scopeId: other.scope.scopeId }));
    expect((await request({ sessionId: id, message: "Wrong scope" })).status).toBe(404);
    f.loader.setSessionFactory(f.factories.createModuleSession);
    expect((await request({ sessionId: "never-created", message: "Unknown work" })).status).toBe(404);
    expect((await request({ sessionId: id, message: "Still recoverable" })).status).toBe(200);
    expect(f.messages()).toContain("direct jade");
    clearSessions();
    expect((await request({ message: "Independent work" })).status).toBe(201);
    expect(f.messages()).not.toContain("direct jade");
  } finally { clearSessions(); await f.close(); }
});

// Detect the standalone HTTP pool id becoming detached from its durable owner.
it("recovers HTTP chat and empty session creation through replacement pools without crossing scopes", async () => {
  const f = fixture();
  let pool = new SessionPool();
  let runtime = f.runtime;
  const factory: HttpAgentFactory = (transport, autonomyMode, binding) => f.track(createHttpAgentSession({
    ...binding, transport, autonomyMode, model: "openai/controlled", moduleLoader: f.loader,
    scopeRuntime: runtime, noHistory: true,
  }));
  const chat = (body: object) => httpRequest(body, (req, res) => handleChat(req, res, pool, factory, () => "supervised"));
  const replace = async () => {
    const agents = pool.list().map(({ id }) => pool.get(id)!.agent);
    pool.closeAll();
    await Promise.all(agents.map((agent) => agent.dispose()));
    pool = new SessionPool();
  };
  try {
    const first = await chat({ message: "Remember HTTP indigo" });
    expect(first.status).toBe(200);
    const id = JSON.parse(first.body.split("data: ")[1].split("\n")[0]).session_id;
    await replace();
    const recovered = await chat({ session_id: id, message: "Recall" });
    expect(recovered.status).toBe(200);
    expect(recovered.body).toContain(id);
    expect(f.messages()).toContain("HTTP indigo");
    expect(f.messages()).toContain("Saved reply");
    await replace();
    runtime = f.runtimes.list().find((scoped) => scoped !== f.runtime)!;
    expect((await chat({ session_id: id, message: "Wrong scope" })).status).toBe(404);
    runtime = f.runtime;
    expect((await chat({ session_id: "never-created", message: "Unknown work" })).status).toBe(404);
    expect((await chat({ session_id: 42, message: "Invalid identity" })).status).toBe(400);
    expect((await chat({ message: "Independent work" })).status).toBe(200);
    expect(f.messages()).not.toContain("HTTP indigo");
    const empty = await httpRequest({}, (req, res) => handleCreateSession(req, res, pool, factory, () => "supervised"));
    expect(empty.status).toBe(201);
    const emptyId = JSON.parse(empty.body).session_id;
    await replace();
    expect((await chat({ session_id: emptyId, message: "First message after replacement" })).status).toBe(200);
    expect(f.messages()).not.toContain("HTTP indigo");
    expect(f.messages()).not.toContain("Independent work");
  } finally { await replace(); await f.close(); }
});
