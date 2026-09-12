import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { recoverNativeConversationStop } from "./conversation-lock.js";
import { createConversationSessionRuntime } from "./conversation-runtime.js";
import { runAgentHarness } from "./runner.js";
import { agentConversationRoot, resetAgentConversation, SessionRecoveryError } from "./session-continuity.js";
import type { AgentHarness, AgentHarnessRunOptions } from "./types.js";
import { ZERO_AGENT_USAGE } from "./usage.js";

const roots: string[] = [];
function scope() { const root = mkdtempSync(join(tmpdir(), "kota-continuity-")); roots.push(root); return root; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const result = { text: "done", streamedText: "", turns: 1, usage: ZERO_AGENT_USAGE, isError: false };
function adapter(run: AgentHarness["run"]): AgentHarness {
  return { name: "conversation-test", description: "Controlled conversation port", supportsMultiTurn: true, supportedHookKinds: ["preRun", "postRun"], askOwnerToolName: null, emitsAgentMessageStream: false, toolControl: "kota", run };
}
function conversation(options: AgentHarnessRunOptions) {
  return createConversationSessionRuntime({ harness: "conversation-test", options, scopeRoot: options.scopeRoot!, resolved: { model: "test", providerName: "controlled" }, outputTokenLimit: { maxTokens: 100 } });
}
function checkpoint(root: string) {
  const owners = join(root, ".kota/openai-tools-agent-harness/sessions/owners");
  return JSON.parse(readFileSync(join(owners, readdirSync(owners)[0], "continuity.json"), "utf8"));
}

it.each(["{broken json", '{"version":99}'])("resumes a healthy explicit identity despite an unrelated corrupt checkpoint: %s", async (corrupt) => {
  const root = scope();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "healthy" };
  const run = adapter(async (options) => {
    const session = conversation(options);
    session.messages.push({ role: "assistant", content: "Preserved healthy work" });
    return session.finalize(result, undefined);
  });
  const original = await runAgentHarness(run, options);
  const brokenDirectory = join(agentConversationRoot(root), "owners", "000-corrupt");
  mkdirSync(brokenDirectory);
  const brokenPath = join(brokenDirectory, "continuity.json");
  writeFileSync(brokenPath, corrupt);
  const resumed = await runAgentHarness(adapter(async (options) => {
    expect(options.continuityKey).toBe("healthy");
    const session = conversation(options);
    expect(JSON.stringify(session.messages)).toContain("Preserved healthy work");
    return session.finalize(result, undefined);
  }), { ...options, continuityKey: undefined, resumeSessionId: original.sessionId });
  expect(resumed.sessionId).toBe(original.sessionId);
  expect(readFileSync(brokenPath, "utf8")).toBe(corrupt);
});

it("recovers disk checkpoints after the hosting process exits without returning or releasing its owner", async () => {
  const root = scope();
  const source = `
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    import { runAgentHarness } from ${JSON.stringify(new URL("./runner.ts", import.meta.url).href)};
    import { createConversationSessionRuntime } from ${JSON.stringify(new URL("./conversation-runtime.ts", import.meta.url).href)};
    const [root, phase] = process.argv.slice(1);
    const harness = {
      name: "process-recovery-port", supportedHookKinds: [], toolControl: "kota",
      run: async (options) => {
        const session = createConversationSessionRuntime({
          harness: "process-recovery-port", options, scopeRoot: root,
          resolved: { model: "controlled", providerName: "controlled" },
          outputTokenLimit: { maxTokens: 100 },
        });
        if (phase === "interrupt") {
          session.messages.push({ role: "assistant", content: "Preserved design: blue." });
          session.checkpoint();
          writeFileSync(join(root, "saved-work.txt"), "blue");
          process.exit(17);
        }
        return session.finalize({
          text: JSON.stringify({ messages: session.messages, instructions: options.systemPrompt }),
          streamedText: "", turns: 1, isError: false,
          usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } },
        });
      },
    };
    const result = await runAgentHarness(harness, {
      prompt: phase, systemPrompt: "current policy", scopeRoot: root, cwd: root,
      continuityKey: "workflow:interrupted-run:agent:build", effort: "high",
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const run = (phase: string) => promisify(execFile)(process.execPath, [
    "--conditions=source", "--import", "tsx", "--input-type=module", "--eval", source, root, phase,
  ]);
  await expect(run("interrupt")).rejects.toMatchObject({ code: 17 });
  const original = checkpoint(root).sessionId;
  const { stdout } = await run("resume");
  const recovered = JSON.parse(stdout);
  expect(recovered.sessionId).toBe(original);
  expect(recovered.text).toContain("Preserved design: blue.");
  expect(recovered.text).toContain("current policy");
  expect(readFileSync(join(root, "saved-work.txt"), "utf8")).toBe("blue");
});

it.each([false, true])("recovers fenced native execution after evidenced stop following abrupt host exit (identity checkpointed: %s)", async (checkpointed) => {
  const root = scope();
  const source = `
    import { writeFileSync, readFileSync } from "node:fs";
    import { join } from "node:path";
    import { runAgentHarness } from ${JSON.stringify(new URL("./runner.ts", import.meta.url).href)};
    import { resetAgentConversation } from ${JSON.stringify(new URL("./session-continuity.ts", import.meta.url).href)};
    const [root, phase, checkpointed] = process.argv.slice(1);
    const harness = {
      name: "native-crash-port", supportedHookKinds: [], toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      run: async (options) => {
        options.abortQuarantine.register(async () => {});
        if (checkpointed === "true") options.onSessionId("remote-crash-conversation");
        if (phase === "crash") {
          writeFileSync(join(root, "saved-work.txt"), "Preserved design: blue");
          process.exit(17);
        }
        if (phase === "recovered") {
          process.stdout.write(JSON.stringify({ sessionId: options.resumeSessionId, work: readFileSync(join(root, "saved-work.txt"), "utf8"), instructions: options.systemPrompt }));
        }
        return { text: "safe", streamedText: "", turns: 1, isError: false,
          usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } } };
      },
    };
    if (phase === "reset") resetAgentConversation(root, "native-owner", "operator reset");
    else await runAgentHarness(harness, {
      prompt: "work", systemPrompt: "current policy", scopeRoot: root, cwd: root, effort: "high",
      ...(phase === "explicit" ? { resumeSessionId: "remote-crash-conversation" }
        : { continuityKey: phase === "independent" ? "independent" : "native-owner" }),
      ...(phase === "discard" ? { persistSession: false } : {}),
    });
  `;
  const run = (phase: string) => promisify(execFile)(process.execPath, [
    "--conditions=source", "--import", "tsx", "--input-type=module", "--eval", source,
    root, phase, String(checkpointed && phase !== "independent"),
  ]);
  await expect(run("crash")).rejects.toMatchObject({ code: 17 });
  for (const phase of ["resume", "reset", "discard", ...(checkpointed ? ["explicit"] : [])]) {
    await expect(run(phase)).rejects.toThrow("unresolved native stop");
  }
  await expect(run("independent")).resolves.toMatchObject({ stderr: "" });
  const storeRoot = agentConversationRoot(root);
  const fences = readdirSync(join(storeRoot, "locks")).filter((name) => name.endsWith(".unresolved-stop.json"));
  const executionId = JSON.parse(readFileSync(join(storeRoot, "locks", fences[0]), "utf8")).executionId;
  const input = { executionId, confirmedStopped: true, evidence: "Observed test host exit code 17; this controlled native port launches no subprocess or remote work." };
  expect(() => recoverNativeConversationStop(storeRoot, { ...input, confirmedStopped: false })).toThrow("explicit confirmation");
  expect(() => recoverNativeConversationStop(storeRoot, { ...input, evidence: " " })).toThrow("nonempty stop evidence");
  expect(() => recoverNativeConversationStop(scope(), input)).toThrow("No unresolved native stop");
  const recovered = recoverNativeConversationStop(storeRoot, input);
  expect(recovered.recoveredLocks).toBe(checkpointed ? 2 : 1);
  expect(JSON.parse(readFileSync(recovered.evidencePath, "utf8"))).toMatchObject(input);
  expect(JSON.parse((await run("recovered")).stdout)).toEqual({
    ...(checkpointed ? { sessionId: "remote-crash-conversation" } : {}),
    work: "Preserved design: blue", instructions: "current policy",
  });
  await expect(run("reset")).resolves.toMatchObject({ stderr: "" });
  await expect(run("crash")).rejects.toMatchObject({ code: 17 });
  expect(() => recoverNativeConversationStop(storeRoot, input)).toThrow("No unresolved native stop");
  await expect(run("resume")).rejects.toThrow("unresolved native stop");
});

it("recovers an interrupted conversation from disk before a successful result, retaining saved work and current instructions", async () => {
  const root = scope();
  const options = { prompt: "original task", effort: "high" as const, scopeRoot: root, cwd: root, continuityKey: "workflow:run:agent:build" };
  let id: string | undefined;
  await expect(runAgentHarness(adapter(async (run) => {
    const session = conversation(run); id = session.sessionId;
    session.messages.push({ role: "assistant", content: "The chosen design is blue." });
    session.checkpoint();
    writeFileSync(join(root, "saved-work.txt"), "blue");
    throw new Error("provider quota interrupted the process");
  }), options)).rejects.toThrow("quota");
  expect(checkpoint(root).sessionId).toBe(id);
  const currentGuard = vi.fn();
  const resumed = await runAgentHarness(adapter(async (run) => {
    expect(run.resumeSessionId).toBe(id);
    expect(run.canUseTool).toBe(currentGuard);
    expect(run.systemPrompt).toBe("current policy");
    const session = conversation(run);
    expect(JSON.stringify(session.messages)).toContain("The chosen design is blue.");
    expect(readFileSync(join(root, "saved-work.txt"), "utf8")).toBe("blue");
    return session.finalize(result, undefined);
  }), { ...options, systemPrompt: "current policy", canUseTool: currentGuard, prompt: "continue" });
  expect(resumed.sessionId).toBe(id);
});

it("admits one active owner and isolates concurrent roles and scopes", async () => {
  const root = scope();
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const run = adapter(async (options) => {
    const session = conversation(options); started(); await waiting;
    return session.finalize(result, undefined);
  });
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "builder" };
  const first = runAgentHarness(run, options);
  await ready;
  await expect(runAgentHarness(run, options)).rejects.toThrow("active owner");
  const second = runAgentHarness(run, { ...options, continuityKey: "critic" });
  const third = runAgentHarness(run, { ...options, scopeRoot: scope() });
  finish();
  const results = await Promise.all([first, second, third]);
  expect(new Set(results.map((entry) => entry.sessionId)).size).toBe(3);
});

it("creates one evidenced successor for missing state, never for authentication or quota failure", async () => {
  const root = scope();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "builder" };
  const original = await runAgentHarness(adapter(async (run) => conversation(run).finalize(result, undefined)), options);
  const fail = vi.fn(async () => { throw new Error("authentication expired"); });
  await expect(runAgentHarness(adapter(fail), options)).rejects.toThrow("authentication");
  expect(fail).toHaveBeenCalledTimes(1);
  expect(checkpoint(root).sessionId).toBe(original.sessionId);
  rmSync(join(root, ".kota/openai-tools-agent-harness/sessions", `${original.sessionId}.json`));
  const calls: AgentHarnessRunOptions[] = [];
  const successor = await runAgentHarness(adapter(async (run) => {
    calls.push(run);
    return conversation(run).finalize(result, undefined);
  }), options);
  expect(calls).toHaveLength(2);
  expect(calls[1].prompt).toContain("successor conversation");
  expect(successor.sessionId).not.toBe(original.sessionId);
  expect(checkpoint(root)).toMatchObject({ disposition: "successor", generation: 1 });
  const failedAgain = vi.fn(async () => { throw new SessionRecoveryError("expired"); });
  await expect(runAgentHarness(adapter(failedAgain), options)).rejects.toThrow("expired");
  expect(failedAgain).toHaveBeenCalledTimes(2);
});

it("retains ambiguous tool calls without replay and records explicit resets", async () => {
  const root = scope();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "interactive" };
  const original = await runAgentHarness(adapter(async (run) => {
    const session = conversation(run);
    session.messages.push({ role: "assistant", content: [{ type: "tool_use", id: "effect", name: "send", input: {} }] });
    return session.finalize(result, undefined);
  }), options);
  await runAgentHarness(adapter(async (run) => {
    const session = conversation(run);
    expect(JSON.stringify(session.messages)).toContain("The effect may have happened");
    return session.finalize(result, undefined);
  }), options);
  resetAgentConversation(root, "interactive", "Operator reset");
  const next = await runAgentHarness(adapter(async (run) => {
    expect(run.resumeSessionId).toBeUndefined();
    const session = conversation(run);
    expect(session.messages).toHaveLength(1);
    return session.finalize(result, undefined);
  }), options);
  expect(next.sessionId).not.toBe(original.sessionId);
  expect(readFileSync(join(root, ".kota/openai-tools-agent-harness/sessions", `${original.sessionId}.json`), "utf8")).toContain("effect");
});

it("keeps successor lineage across later attempts with an ancestor step result and changed context", async () => {
  const root = scope();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "builder" };
  const run = adapter(async (run) => conversation(run).finalize(result, undefined));
  const first = await runAgentHarness(run, options);
  rmSync(join(root, ".kota/openai-tools-agent-harness/sessions", `${first.sessionId}.json`));
  const second = await runAgentHarness(run, options);
  const third = await runAgentHarness(run, { ...options, resumeSessionId: first.sessionId });
  expect(third.sessionId).toBe(second.sessionId);
  expect(checkpoint(root)).toMatchObject({ disposition: "successor", generation: 1 });
  const changed = await runAgentHarness(run, { ...options, model: "different-model" });
  expect(changed.sessionId).not.toBe(second.sessionId);
  expect(checkpoint(root)).toMatchObject({ disposition: "successor", generation: 2 });
});

it("validates identities during cancellation drain and quarantines them after ownership release", async () => {
  const root = scope();
  const abortController = new AbortController();
  let lateOptions!: AgentHarnessRunOptions;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "owner" };
  let finish!: () => void;
  const draining = new Promise<void>((resolve) => { finish = resolve; });
  const pending = runAgentHarness(adapter(async (run) => {
    lateOptions = run;
    conversation(run);
    started();
    await draining;
    return result;
  }), { ...options, abortController });
  await ready;
  const id = checkpoint(root).sessionId;
  abortController.abort(new Error("interrupted"));
  await expect(pending).rejects.toThrow("interrupted");
  expect(() => lateOptions.onSessionId?.("late-id")).toThrow("changed a preserved conversation identity");
  expect(checkpoint(root).sessionId).toBe(id);
  await expect(runAgentHarness(adapter(async () => result), { ...options, continuityKey: "other-owner", resumeSessionId: id })).rejects.toThrow("different work");
  finish();
  await pending.settled;
  lateOptions.onSessionId?.("after-release-id");
  expect(checkpoint(root).sessionId).toBe(id);
});



it("excludes independently hosted resumes and resets while preserving completed turns", async () => {
  const root = scope();
  const source = `
    import { runAgentHarness } from ${JSON.stringify(new URL("./runner.ts", import.meta.url).href)};
    import { resetAgentConversation } from ${JSON.stringify(new URL("./session-continuity.ts", import.meta.url).href)};
    import { createConversationSessionRuntime } from ${JSON.stringify(new URL("./conversation-runtime.ts", import.meta.url).href)};
    const [root, phase, sessionId] = process.argv.slice(1);
    const harness = {
      name: "process-concurrency-port", supportedHookKinds: [], toolControl: "kota",
      run: async (options) => {
        const session = createConversationSessionRuntime({
          harness: "process-concurrency-port", options, scopeRoot: root,
          resolved: { model: "controlled", providerName: "controlled" },
          outputTokenLimit: { maxTokens: 100 },
        });
        if (phase === "hold") {
          const finish = new Promise((resolve) => process.once("message", resolve));
          process.send({ sessionId: session.sessionId });
          await finish;
          process.disconnect();
        }
        session.messages.push({ role: "assistant", content: phase + " completed turn" });
        return session.finalize({
          text: JSON.stringify(session.messages), streamedText: "", turns: 1, isError: false,
          usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } },
        });
      },
    };
    if (phase === "reset") {
      resetAgentConversation(root, "shared", "operator reset");
    } else {
      const result = await runAgentHarness(harness, {
        prompt: phase, scopeRoot: root, cwd: root, effort: "high",
        ...(phase === "resume" ? { resumeSessionId: sessionId } : { continuityKey: phase === "independent" ? "independent" : "shared" }),
      });
      process.stdout.write(JSON.stringify(result));
    }
  `;
  const args = (phase: string, id = "") => [
    "--conditions=source", "--import", "tsx", "--input-type=module", "--eval", source, root, phase, id,
  ];
  const child = spawn(process.execPath, args("hold"), { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const finished = once(child, "exit");
  let stderr = "";
  child.stderr!.on("data", (chunk) => { stderr += chunk; });
  try {
    const ready = await Promise.race([
      once(child, "message"),
      finished.then(() => { throw new Error(`Conversation host exited before admission: ${stderr}`); }),
    ]);
    const id = (ready[0] as { sessionId: string }).sessionId;
    const run = (phase: string) => promisify(execFile)(process.execPath, args(phase, id));
    for (const phase of ["same-owner", "resume", "reset"]) {
      await expect(run(phase)).rejects.toThrow("active owner");
    }
    const independent = JSON.parse((await run("independent")).stdout);
    expect(independent.sessionId).not.toBe(id);
    child.send("finish");
    expect((await finished)[0], stderr).toBe(0);
    const resumed = JSON.parse((await run("resume")).stdout);
    expect(resumed.sessionId).toBe(id);
    expect(resumed.text).toContain("hold completed turn");
    expect(resumed.text).toContain("resume completed turn");
    await run("reset");
    const reset = JSON.parse((await run("same-owner")).stdout);
    expect(reset.sessionId).not.toBe(id);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await finished; }
  }
});

it("releases ownership when checkpoint preparation fails", async () => {
  const root = scope();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "builder" };
  const run = adapter(async (run) => conversation(run).finalize(result, undefined));
  const original = await runAgentHarness(run, options);
  const owners = join(root, ".kota/openai-tools-agent-harness/sessions/owners");
  const path = join(owners, readdirSync(owners)[0], "continuity.json");
  const saved = readFileSync(path, "utf8");
  writeFileSync(path, "corrupt");
  await expect(runAgentHarness(run, options)).rejects.toThrow();
  writeFileSync(path, saved);
  expect((await runAgentHarness(run, options)).sessionId).toBe(original.sessionId);
});

it.each([false, true])("retains failed native-stop exclusion across hosts (execution settled: %s)", async (executionSettled) => {
  const root = scope();
  const abortController = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let finish!: () => void;
  const draining = new Promise<void>((resolve) => { finish = resolve; });
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "native-owner" };
  const native: AgentHarness = {
    ...adapter(async (run) => {
      run.abortQuarantine!.register(async () => {
        if (executionSettled) finish();
        throw new Error("Remote stop remains unconfirmed");
      });
      if (executionSettled) run.onSessionId!("remote-conversation");
      started();
      await draining;
      run.onSessionId!("remote-conversation");
      return { ...result, sessionId: "remote-conversation" };
    }),
    toolControl: "native",
    nativeAbortQuarantine: "confirmed-stop",
  };
  const pending = runAgentHarness(native, { ...options, abortController });
  const settlement = pending.settled.then(() => "released", (error: Error) => error.message);
  await ready;
  abortController.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("failed to quarantine");
  expect(await settlement).toContain("Remote stop remains unconfirmed");
  finish();
  await draining;
  await vi.waitFor(() => expect(() => resetAgentConversation(root, "native-owner", "reset")).toThrow("unresolved native stop"));
  const launch = vi.fn(async () => result);
  for (const changes of [{}, { persistSession: false }, { continuityKey: undefined, resumeSessionId: "remote-conversation" }]) {
    await expect(runAgentHarness(adapter(launch), { ...options, ...changes })).rejects.toThrow("unresolved native stop");
  }
  expect(() => resetAgentConversation(root, "native-owner", "reset")).toThrow("unresolved native stop");
  expect(launch).not.toHaveBeenCalled();
  const source = `
    import { acquireConversationLock } from ${JSON.stringify(new URL("./conversation-lock.ts", import.meta.url).href)};
    const [storeRoot, identity] = process.argv.slice(1);
    acquireConversationLock(storeRoot, JSON.parse(identity))();
  `;
  for (const identity of [["owner", "native-owner"], ["session", native.name, "remote-conversation"]]) {
    await expect(promisify(execFile)(process.execPath, [
      "--conditions=source", "--import", "tsx", "--input-type=module", "--eval", source,
      agentConversationRoot(root), JSON.stringify(identity),
    ])).rejects.toThrow("unresolved native stop");
  }
  await expect(runAgentHarness(adapter(async () => result), { ...options, continuityKey: "independent" })).resolves.toMatchObject(result);
});

it("allows recovery after confirmed native stop even if the old result never arrives", async () => {
  const root = scope();
  const abortController = new AbortController();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "native-owner" };
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const native: AgentHarness = {
    ...adapter(async (run) => {
      run.abortQuarantine!.register(async () => {});
      run.onSessionId!("confirmed-conversation");
      started();
      return new Promise(() => {});
    }),
    toolControl: "native",
    nativeAbortQuarantine: "confirmed-stop",
  };
  const pending = runAgentHarness(native, { ...options, abortController });
  await ready;
  abortController.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  await expect(pending.settled).resolves.toBeUndefined();
  await runAgentHarness(adapter(async (run) => {
    expect(run.resumeSessionId).toBe("confirmed-conversation");
    return result;
  }), options);
  expect(() => resetAgentConversation(root, "native-owner", "reset after confirmed stop")).not.toThrow();
});

it("does not create a successor when retiring the native recovery attempt fails to confirm stop", async () => {
  const root = scope();
  const options = { prompt: "work", effort: "high" as const, scopeRoot: root, continuityKey: "native-owner" };
  await runAgentHarness(adapter(async (run) => {
    run.onSessionId!("missing-conversation");
    return result;
  }), options);
  const run = vi.fn(async (options: AgentHarnessRunOptions) => {
    options.abortQuarantine!.register(() => { throw new Error("Remote retirement unconfirmed"); });
    throw new SessionRecoveryError("session unavailable");
  });
  const native: AgentHarness = { ...adapter(run), toolControl: "native", nativeAbortQuarantine: "confirmed-stop" };
  const pending = runAgentHarness(native, { ...options, abortController: new AbortController() });
  await expect(pending).rejects.toThrow("Remote retirement unconfirmed");
  await expect(pending.settled).rejects.toThrow("Remote retirement unconfirmed");
  expect(run).toHaveBeenCalledOnce();
  expect(checkpoint(root)).toMatchObject({ sessionId: "missing-conversation", generation: 0 });
  expect(() => resetAgentConversation(root, "native-owner", "reset")).toThrow("unresolved native stop");
});

it("rejects operator recovery of a live native owner without clearing any identity fence", async () => {
  const root = scope();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const native: AgentHarness = { ...adapter(async (options) => {
    options.abortQuarantine!.register(() => pending);
    options.onSessionId!("live-native-id");
    ready();
    await pending;
    return result;
  }), toolControl: "native", nativeAbortQuarantine: "confirmed-stop" };
  const run = runAgentHarness(native, { prompt: "work", scopeRoot: root, continuityKey: "live-native", effort: "high" });
  await started;
  try {
    const storeRoot = agentConversationRoot(root);
    const fences = readdirSync(join(storeRoot, "locks")).filter((name) => name.endsWith(".unresolved-stop.json"));
    const executionId = JSON.parse(readFileSync(join(storeRoot, "locks", fences[0]), "utf8")).executionId;
    expect(() => recoverNativeConversationStop(storeRoot, { executionId, confirmedStopped: true, evidence: "An operator assertion cannot override live ownership." })).toThrow("active owner");
    for (const name of fences) expect(JSON.parse(readFileSync(join(storeRoot, "locks", name), "utf8")).executionId).toBe(executionId);
  } finally { finish(); await run; }
});
