import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import * as workflowCommands from "#core/workflow/workflow-command.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { autonomyHealthSignal, normalizeHealthSignal } from "#modules/autonomy/health-signal.js";
import reviewer from "#modules/autonomy/workflows/autonomy-health-reviewer/workflow.js";
import { builderTaskResources } from "#modules/autonomy/workflows/builder/task-contract.js";
import dispatcher from "#modules/autonomy/workflows/dispatcher/workflow.js";
import { runGitEvidenceCommand } from "#modules/autonomy/workflows/git-evidence-test-support.js";
import { scopePolicySnapshotForTest } from "#modules/autonomy/workflows/scope-improver/scope-policy-test-support.js";

// Socket availability and the Git process launcher are external ports;
// allocation, queueing, Git evidence, workers and persistence are real.
vi.mock("node:net", async (original) => ({
  ...await original<typeof import("node:net")>(),
  createServer: () => {
    const server = {
      unref: () => server, once: () => server,
      listen: (_options: unknown, listening: () => void) => { listening(); return server; },
      close: (closed: () => void) => { closed(); return server; },
    };
    return server;
  },
}));

// Detects coalescing that loses occurrence evidence, oversized step handoffs, and
// starvation of automatic task inspection behind a full shared execution queue.
it("drains a paused incident burst while automatically dispatching newly published work", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kota-incident-burst-")));
  const stateDir = join(root, ".kota");
  const scopeId = deriveDirectoryScopeId(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".kota/\n");
  git("init", "--quiet");
  git("add", ".gitignore");
  const commit = () => git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "fixture input");
  commit();
  const database = new RunStateDatabase(stateDir);
  database.registerScope({ id: scopeId, rootPath: root, createdAt: new Date().toISOString() });
  const { epoch } = database.beginDaemonSession(new Date().toISOString());
  const bus = new EventBus();
  const pbus = new ScopedEventBus(bus, scopeId);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let holders = 0;
  const delivered: string[] = [];
  const decisions: string[] = [];
  bus.on(autonomyIssueDecisionRequested, (request) => decisions.push(request.rootCauseKey));
  let runtime!: WorkflowRuntime;
  const coordinator = new RunCoordinator({ store: database, daemonEpoch: epoch, concurrency: 2,
    execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) => runtime.deliverPublication(publication),
  });
  runtime = new WorkflowRuntime({ bus, pbus, scopeRoot: root, scopeId, runState: database,
    runCoordinator: coordinator, daemonEpoch: epoch, idleIntervalMs: 10,
    scopePolicyAuthority: { getSnapshot: () => scopePolicySnapshotForTest(root), subscribeRestrictiveChanges: () => () => {} },
    workflows: [
      registerWorkflowDefinition("fixture/holder.ts", {
        name: "metadata-holder", repository: "none", triggers: [{ event: "metadata.ready", queueMode: "all" }],
        steps: [{ id: "hold", type: "code", run: async () => { holders++; await held; return null; } }],
      }),
      registerWorkflowDefinition("src/modules/autonomy/workflows/autonomy-health-reviewer/workflow.ts", reviewer),
      registerWorkflowDefinition("src/modules/autonomy/workflows/dispatcher/workflow.ts", { ...dispatcher,
        triggers: dispatcher.triggers.map((trigger) => ({ ...trigger, cooldownMs: 0 })),
      }),
      registerWorkflowDefinition("fixture/delivery.ts", {
        name: "delivery", repository: "none", resources: builderTaskResources,
        triggers: [{ event: "autonomy.queue.available", queueMode: "all" }],
        steps: [{ id: "deliver", type: "code", run: (ctx) => { delivered.push(String(ctx.trigger.payload.taskId)); return null; } }],
      }),
    ],
  });
  const signals = Array.from({ length: 475 }, (_, index) => normalizeHealthSignal({
    signalId: `poll-${index}`, observation: "present", source: { kind: "module-log", id: "telegram", module: "telegram" },
    severity: "error", actionability: "external-service", dedupeKey: "module:telegram:external-provider-failure",
    labels: ["operation/poll-loop"], summary: "Poll failed", observationCount: 1,
    createdAt: new Date(Date.UTC(2026, 8, 15, 12, 0, index)).toISOString(),
    evidenceRefs: [{ kind: "module-log", ref: `.kota/logs/telegram.jsonl#poll-${index}`,
      moduleOperation: { operation: "poll-loop", observation: "present", observedAt: new Date(Date.UTC(2026, 8, 15, 12, 0, index)).toISOString() } }],
  }));
  const runs = () => database.listRuns(scopeId);
  const reviews = () => runs().filter((run) => run.workflow === reviewer.name);
  const latencies: number[] = [];
  let peakCapacity = 0;
  let statusSamplesDuringReview = 0;
  let lastTick = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    // Exercise the status projection used by workflow control while observing main-thread delay.
    JSON.stringify(runtime.getState());
    if (reviews().some((run) => run.state === "running")) statusSamplesDuringReview++;
    latencies.push(performance.now() - lastTick - 10);
    lastTick = now;
    peakCapacity = Math.max(peakCapacity, coordinator.occupiedCapacity);
  }, 10);
  const commandPort = vi.spyOn(workflowCommands, "createWorkflowCommandRunner").mockImplementation(() => async (input) => {
    expect(input.command).toBe("git");
    expect(input.cwd).toBe(root);
    return runGitEvidenceCommand(input);
  });
  runtime.start("paused");
  try {
    pbus.emitDynamic("metadata.ready", { index: 1 });
    pbus.emitDynamic("metadata.ready", { index: 2 });
    const enqueueStarted = performance.now();
    for (const signal of signals) pbus.emit(autonomyHealthSignal, signal);
    const enqueueMs = performance.now() - enqueueStarted;
    expect(reviews()).toHaveLength(1);
    const batch = reviews()[0].trigger.payload as WorkflowBatchFlushPayload;
    expect(batch.inputEvents.map((event) => event.payload.signalId)).toEqual(signals.map((signal) => signal.signalId));
    expect(batch.count).toBe(475);
    runtime.setDispatchPaused(false);
    await expect.poll(() => holders).toBe(2);
    writeFileSync(join(root, "data/tasks/task-new.md"), "---\nstatus: open\npriority: p1\n---\n# New delivery\n\nDeliver newly available work.\n");
    git("add", "data/tasks/task-new.md");
    commit();
    await expect.poll(() => runs().some((run) => run.state === "queued" && run.trigger.event === "runtime.idle")).toBe(true);
    expect(coordinator.occupiedCapacity).toBe(2);
    release();
    await expect.poll(() => delivered.includes("task-new"), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => reviews().every((run) => run.state === "succeeded"), { timeout: 10_000 }).toBe(true);
    const first = database.readScopeStateValue<AutonomyIssueProjection>(scopeId, AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value!;
    expect(first.issues[0].occurrenceCount).toBe(475);
    expect(first.issues[0].history).toHaveLength(475);
    expect(decisions).toEqual(["module:telegram:external-provider-failure"]);
    // Redelivery is queue-idempotent; fresh repeated signals must still preserve provenance without a second decision.
    for (const signal of signals.slice(0, 5)) pbus.emit(autonomyHealthSignal, { ...signal, signalId: `repeat-${signal.signalId}` });
    pbus.emit(autonomyHealthSignal, normalizeHealthSignal({ ...signals[0], signalId: "critical-independent", severity: "critical", dedupeKey: "independent:critical", source: { kind: "workflow", id: "independent" } }));
    await expect.poll(() => reviews().length === 3 && reviews().every((run) => run.state === "succeeded"), { timeout: 10_000 }).toBe(true);
    expect(decisions).toEqual(["module:telegram:external-provider-failure", "independent:critical"]);
    const artifact = JSON.parse(readFileSync(join(stateDir, "runs", reviews()[0].id, "autonomy-health-review.json"), "utf8"));
    expect(artifact.review.signals.map((signal: { signalId: string }) => signal.signalId)).toEqual(signals.map((signal) => signal.signalId));
    expect(peakCapacity).toBe(2);
    expect(statusSamplesDuringReview).toBeGreaterThan(0);
    process.stdout.write(`[incident-burst-evidence] ${JSON.stringify({ inputs: 475, pausedReviewRuns: 1, enqueueMs, peakCapacity, statusSamplesDuringReview, maxStatusAndTimerDelayMs: Math.max(...latencies), delivered, decisions })}\n`);
  } finally {
    commandPort.mockRestore(); release(); clearInterval(timer); await runtime.stop(); await coordinator.dispose(); database.close(); rmSync(root, { recursive: true, force: true });
  }
});
