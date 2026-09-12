import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import type { KotaMessageStream, KotaModelResponse } from "#core/agent-harness/message-protocol.js";
import { agentConversationRoot } from "#core/agent-harness/session-continuity.js";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { createScopeRuntime } from "#core/daemon/scope-runtime.js";
import { EventBus } from "#core/events/event-bus.js";
import { type MessageStreamParams, registerModelClientFactory } from "#core/model/model-client.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { TelegramMessageRuntime } from "#modules/telegram/bot-message-runtime.js";

class TelegramCommands extends TelegramMessageRuntime {
  dispatch(text: string, chat = 7) { return this.handleMessage(chat, text); }
  close() { return Promise.all([this.closeSessionsForChat(7), this.closeSessionsForChat(8)]); }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kota-telegram-model-recovery-"));
  const scope = buildDirectoryScope({ scopeRoot: root });
  const runState = new RunStateDatabase(join(root, ".kota"));
  const createdAt = new Date().toISOString();
  runState.registerScope({ id: scope.scopeId, rootPath: root, displayName: scope.displayName, createdAt });
  const daemonEpoch = runState.beginDaemonSession(createdAt).epoch;
  const runCoordinator = new RunCoordinator({
    store: runState, daemonEpoch, concurrency: 1,
    execute: (run, signal) => runtime.workflowRuntime.executeAdmittedRun(run, signal),
  });
  const runtime = createScopeRuntime({
    scope, bus: new EventBus(), onLog: () => {}, installSingletons: false,
    runState, runCoordinator, daemonEpoch,
  });
  const replies: string[] = [];
  const snapshots: MessageStreamParams[] = [];
  let respond = async (): Promise<KotaModelResponse> => ({
    id: "controlled", role: "assistant", model: "controlled",
    content: [{ type: "text", text: "Saved reply" }], stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  registerModelClientFactory(({ model }) => ({
    model: model ?? "openai/controlled", providerName: "openai",
    client: { messages: {
      create: () => respond(),
      stream(params): KotaMessageStream {
        snapshots.push(structuredClone({ ...params, signal: undefined }));
        const callbacks: ((text: string) => void)[] = [];
        return {
          on(event, callback) { if (event === "text") callbacks.push(callback); return this; },
          async finalMessage() {
            const result = await respond();
            for (const block of result.content) if (block.type === "text") for (const callback of callbacks) callback(block.text);
            return result;
          },
        };
      },
    } },
  }));
  const http = outboundHttpRequestPort((request) => {
    if (String(request.url).endsWith("/sendMessage")) replies.push(JSON.parse(String(request.body)).text);
    return Response.json({ ok: true, result: {} });
  });
  const bots: TelegramCommands[] = [];
  const bot = (token = "123:credential", model = "openai/controlled") => {
    const instance = new TelegramCommands({
      token, autonomyMode: "supervised", http,
      config: { defaultAgentHarness: "codex", model },
      moduleLoader: new ModuleLoader({}),
      defaultScopeRuntime: runtime, getScopeRuntime: () => runtime,
    });
    bots.push(instance);
    return instance;
  };
  return {
    root, bot, snapshots, replies,
    respond(next: typeof respond) { respond = next; },
    async close() {
      await Promise.all(bots.map((bot) => bot.close()));
      runtime.scheduler.stopTimer();
      runtime.scheduler.disconnectBus();
      await runtime.workflowRuntime.stop();
      runState.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Detect the supported provider-qualified route bypassing continuity: drive the
// real Telegram command/session cache, AgentSession, and shared disk store.
it("recovers direct Telegram ModelClient conversations across replacement and credential rotation, isolates chats, and clears before first send", async () => {
  const f = fixture();
  try {
    const first = f.bot();
    await first.dispatch("Remember the private phrase cobalt maple");
    expect(f.replies).toContain("Saved reply");
    await first.close();
    const replacement = f.bot("123:rotated");
    await replacement.dispatch("Recall the phrase");
    expect(JSON.stringify(f.snapshots.at(-1)?.messages)).toContain("cobalt maple");
    expect(JSON.stringify(f.snapshots.at(-1)?.messages)).toContain("Saved reply");
    await replacement.dispatch("A different chat", 8);
    expect(JSON.stringify(f.snapshots.at(-1)?.messages)).not.toContain("cobalt maple");
    await replacement.close();
    const cleared = f.bot();
    await cleared.dispatch("/clear");
    await cleared.dispatch("Start again");
    expect(JSON.stringify(f.snapshots.at(-1)?.messages)).not.toContain("cobalt maple");
    expect(f.replies).toContain("Conversation cleared.");
    const files = readdirSync(agentConversationRoot(f.root)).filter((name) => name.endsWith(".json"));
    expect(files.some((name) => readFileSync(join(agentConversationRoot(f.root), name), "utf8").includes("cobalt maple"))).toBe(true);
  } finally { await f.close(); }
});

it("retains authentication failures, recovers corrupt context with a recorded successor, and waits for an active turn before clear", async () => {
  const f = fixture();
  try {
    const first = f.bot();
    f.respond(async () => { throw new Error("authentication unavailable"); });
    await first.dispatch("Retain this interrupted request");
    await first.close();
    const root = agentConversationRoot(f.root);
    const recordPath = join(root, readdirSync(root).find((name) => name.endsWith(".json"))!);
    expect(readFileSync(recordPath, "utf8")).toContain("Retain this interrupted request");
    const ownerRoot = join(root, "owners", readdirSync(join(root, "owners"))[0]);
    expect(JSON.parse(readFileSync(join(ownerRoot, "continuity.json"), "utf8")).generation).toBe(0);
    writeFileSync(recordPath, "{damaged context");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let ready!: () => void;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    f.respond(async () => {
      ready();
      await waiting;
      return { id: "late", role: "assistant", model: "controlled", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const replacement = f.bot();
    const send = replacement.dispatch("Continue safely");
    await started;
    expect(JSON.stringify(f.snapshots.at(-1)?.messages)).toContain("successor conversation");
    expect(JSON.parse(readFileSync(join(ownerRoot, "continuity.json"), "utf8"))).toMatchObject({ generation: 1, disposition: "successor" });
    expect(readFileSync(recordPath, "utf8")).toBe("{damaged context");
    const clear = replacement.dispatch("/clear");
    await setImmediate();
    expect(f.replies).not.toContain("Conversation cleared.");
    await replacement.dispatch("While clearing");
    expect(f.replies).toContain("Conversation is being cleared. Please wait.");
    release();
    await send;
    await clear;
    expect(f.replies).toContain("Conversation cleared.");
    await replacement.dispatch("New conversation");
    expect(JSON.stringify(f.snapshots.at(-1)?.messages)).not.toContain("Continue safely");
  } finally { await f.close(); }
});
