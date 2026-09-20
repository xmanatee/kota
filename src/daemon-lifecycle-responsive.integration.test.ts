import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { dispatchControlRequest } from "#core/daemon/control-request-test-support.integration.js";
import { DaemonControlServer } from "#core/daemon/daemon-control.js";
import { DaemonLogger } from "#core/daemon/daemon-logger.js";
import type { LifecycleStatusReport } from "#core/daemon/lifecycle-collector-types.js";
import { workflowAgentRuntimeId } from "#core/workflow/agent-backoff.js";
import { WORKFLOW_RUN_METADATA_VERSION } from "#core/workflow/run-metadata.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { ScopeRuntimeStateStore } from "#core/workflow/scope-runtime-state.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { makeDaemon, mockedExecuteWithAgentSDK, scopeRoot, stateDir } from "./daemon-test-support.integration.js";

// Catches maintenance starving real authenticated control requests while the
// quota gate and shared queue admit evidence and subsequently execute agent work.
// The external agent SDK and logger output are controlled; where loopback is
// denied, an HTTP byte adapter and availability probe replace the OS ports.
it("serves control during periodic and explicit maintenance across quota recovery", async () => {
  let fallback: DaemonControlServer | undefined;
  const listen = DaemonControlServer.prototype.start;
  const listener = vi.spyOn(DaemonControlServer.prototype, "start").mockImplementation(async function (this: DaemonControlServer) {
    try { return await listen.call(this); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      fallback = this;
      return 0;
    }
  });
  const allocate = RunResourceAllocator.prototype.allocate;
  const ports = vi.spyOn(RunResourceAllocator.prototype, "allocate").mockImplementation(function (this: RunResourceAllocator, ...args) {
    if (fallback) (this as unknown as { isPortAvailable: (port: number) => Promise<boolean> }).isPortAvailable = async () => true;
    return allocate.apply(this, args);
  });
  const logs: string[] = [];
  const logging = vi.spyOn(DaemonLogger.prototype, "line").mockImplementation(message => { logs.push(message); });
  const config = { defaultAgentHarness: "claude-agent-sdk", scheduler: { concurrency: 2 } };
  const evidence = join(scopeRoot, "evidence-admitted.txt");
  const promptPath = "src/modules/autonomy/workflows/builder/prompt.md";
  writeFileSync(join(scopeRoot, promptPath), "Return a short verification result.\n");
  mockedExecuteWithAgentSDK.mockResolvedValue({ text: "Verified.", streamedText: "", turns: 1,
    usage: UNKNOWN_AGENT_USAGE, subtype: "success", isError: false });
  const daemon = makeDaemon({ config, idleIntervalMs: 60_000, sessionSweepIntervalMs: 1_000,
    workflows: [
      registerWorkflowDefinition("fixture/evidence.ts", { name: "evidence", repository: "none", triggers: [{ event: "fixture.evidence.ready" }],
        steps: [{ id: "admit", type: "code", run: () => { writeFileSync(evidence, "admitted"); return null; } }] }),
      registerWorkflowDefinition("fixture/agent.ts", { name: "agent", repository: "none", triggers: [{ event: "fixture.agent.ready" }],
        steps: [{ id: "execute", type: "agent", promptPath, model: "claude-sonnet-4-6", effort: "low", autonomyMode: "autonomous" }] }),
    ],
  });
  const running = daemon.start();
  let database: RunStateDatabase | undefined;
  const samples: Array<{ phase: string; path: string; milliseconds: number }> = [];
  let phase = "quota-held";
  let observing = true;
  let observation: Promise<void> | undefined;
  let peakActive = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const timerDelays: number[] = [];
  try {
    await daemon.whenReady();
    const address: { port: number; token: string } = JSON.parse(readFileSync(join(stateDir, "daemon-control.json"), "utf8"));
    const scopeId = daemon.getScopeRegistryProjection().defaultScopeId;
    database = new RunStateDatabase(stateDir);
    const scopeState = new ScopeRuntimeStateStore(database, scopeId);
    const request = (path: string, body?: object) => fallback
      ? dispatchControlRequest(fallback, address.token, body ? "POST" : "GET", path, { body: body ? JSON.stringify(body) : undefined })
      : fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: { Authorization: `Bearer ${address.token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const runCount = 2279;
    const startedAt = new Date().toISOString();
    for (let index = 0; index < runCount; index++) {
      const id = `history-${index}`;
      const runDir = join(stateDir, "runs", id);
      mkdirSync(join(runDir, "nested", "evidence"), { recursive: true });
      writeFileSync(join(runDir, "metadata.json"), JSON.stringify({ metadataVersion: WORKFLOW_RUN_METADATA_VERSION,
        id, workflow: "history", definitionPath: "fixture/history.ts", trigger: { event: "test", schemaRef: null, payload: {} },
        startedAt, completedAt: startedAt, status: "success", runDir, steps: [] }));
      writeFileSync(join(runDir, "nested", "evidence", "result.txt"), "Retained evidence.\n".repeat(50));
    }
    const journalPath = join(stateDir, "events", "journal.jsonl");
    const journalMiB = Number(process.env.KOTA_LIFECYCLE_JOURNAL_MIB ?? 16);
    const line = `${JSON.stringify({ retention: { kind: "retain" }, payload: "x".repeat(2000) })}\n`;
    const block = line.repeat(Math.ceil(1024 * 1024 / Buffer.byteLength(line)));
    for (let index = 0; index < journalMiB; index++) appendFileSync(journalPath, block);
    const journalBytes = statSync(journalPath).size;
    const until = new Date(Date.now() + 3_000).toISOString();
    scopeState.setAgentBackoff({ runtimeId: workflowAgentRuntimeId(config), kind: "rate_limit", failureCount: 1,
      updatedAt: new Date().toISOString(), until, reason: "provider_rate_limit" });
    const held = await request(`/workflow/status?scopeId=${scopeId}`);
    expect(await held.json()).toMatchObject({ agentBackoff: { kind: "rate_limit", until } });
    expect((await request(`/workflow/trigger?scopeId=${scopeId}`, { name: "agent" })).status).toBe(200);
    expect(mockedExecuteWithAgentSDK).not.toHaveBeenCalled();

    let lastTick = performance.now();
    timer = setInterval(() => { const now = performance.now(); timerDelays.push(Math.max(0, now - lastTick - 10)); lastTick = now; }, 10);
    observation = (async () => {
      while (observing) {
        for (const path of ["/health", `/workflow/status?scopeId=${scopeId}`]) {
          const before = performance.now();
          const response = await request(path);
          await response.json();
          samples.push({ phase, path: path.split("?")[0], milliseconds: performance.now() - before });
          expect(response.status).toBe(200);
        }
        peakActive = Math.max(peakActive, database!.listRunStates(scopeId)
          .filter(run => run.state === "running" || run.state === "integrating").length);
        await delay(10);
      }
    })();
    const statusRequest = request(`/lifecycle/status?scopeId=${scopeId}`);
    phase = "evidence-admission";
    expect((await request(`/workflow/trigger?scopeId=${scopeId}`, { name: "evidence" })).status).toBe(200);
    await expect.poll(() => existsSync(evidence)).toBe(true);
    expect(Date.now()).toBeLessThan(Date.parse(until));
    expect(mockedExecuteWithAgentSDK).not.toHaveBeenCalled();
    const response = await statusRequest;
    expect(response.status).toBe(200);
    const report = await response.json() as LifecycleStatusReport;
    expect(report.candidates.filter(candidate => candidate.store === "run-artifacts" && candidate.owner === "history"))
      .toHaveLength(runCount);
    expect(report.candidates.filter(candidate => candidate.owner === "history").every(candidate => candidate.decision === "keep")).toBe(true);
    await expect.poll(() => mockedExecuteWithAgentSDK.mock.calls.length, { timeout: 15_000 }).toBe(1);
    phase = "normal-dispatch";
    await expect.poll(() => database!.listRuns(scopeId).some(run => run.workflow === "agent" && run.state === "succeeded"), { timeout: 15_000 }).toBe(true);
    const sweep = await request(`/lifecycle/sweep`, { scopeId });
    expect(sweep.status).toBe(200);
    expect((await sweep.json()).reclaimedByStore["run-artifacts"]).toBeUndefined();
    expect(statSync(journalPath).size).toBeGreaterThanOrEqual(journalBytes);
    expect(peakActive).toBeLessThanOrEqual(2);
    observing = false;
    await observation;
    expect(samples.length).toBeGreaterThan(20);
    expect(Math.max(...samples.map(sample => sample.milliseconds))).toBeLessThan(1_000);
    expect(Math.max(...timerDelays)).toBeLessThan(1_000);
    const proof = { maximumTimerDelayMs: Math.max(...timerDelays), transport: fallback ? "in-process HTTP adapter (loopback EPERM)" : "TCP loopback", runCount, journalBytes, sampleCount: samples.length, peakActive, samples,
      maximumRequestMs: Math.max(...samples.map(sample => sample.milliseconds)), stages: logs.filter(message => message.startsWith("Lifecycle ")),
      quotaHeld: true, evidenceAdmittedDuringHold: true, agentCompletedAfterRecovery: true };
    if (process.env.KOTA_LIFECYCLE_PROOF_PATH) writeFileSync(process.env.KOTA_LIFECYCLE_PROOF_PATH, JSON.stringify(proof, null, 2));
  } finally {
    observing = false;
    if (timer) clearInterval(timer);
    await observation;
    database?.close();
    await daemon.stop();
    await running;
    logging.mockRestore();
    listener.mockRestore();
    ports.mockRestore();
  }
});
