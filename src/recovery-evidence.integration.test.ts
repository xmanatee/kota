import childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, Server, ServerResponse } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { WorkflowQueueManager } from "#core/workflow/workflow-queue.js";
import { collectBlockedEvidence } from "#modules/autonomy/workflows/blocked-promoter/evidence.js";
import { inspectTargetTaskStep } from "#modules/autonomy/workflows/builder/queue-preflight-steps.js";
import { assessBuilderRecovery } from "#modules/autonomy/workflows/builder/recovery.js";
import { listBuilderTaskDispatches } from "#modules/autonomy/workflows/builder/task-contract.js";

vi.mock("#core/workflow/run-resources.js", async (original) => {
  const actual = await original<typeof import("#core/workflow/run-resources.js")>();
  return {
    ...actual,
    RunResourceAllocator: class extends actual.RunResourceAllocator {
      constructor(store: RunStateDatabase, options: import("#core/workflow/run-resources.js").RunResourceAllocatorOptions) {
        super(store, { ...options, isPortAvailable: async () => true });
      }
    },
  };
});

// Detects control-thread authority materialization while real workflow workers
// concurrently execute builder's preflight. Only the network listener is replaced;
// requests still pass through the production authorizer, routes and daemon.
it("keeps builder preflight and control requests bounded with a representative history", async () => {
  let controlServer: Server | undefined;
  vi.spyOn(Server.prototype, "listen").mockImplementation(function (this: Server, ...args: unknown[]) {
    controlServer = this;
    vi.spyOn(this, "address").mockReturnValue({ address: "127.0.0.1", family: "IPv4", port: 43210 });
    const callback = args.at(-1);
    queueMicrotask(() => { if (typeof callback === "function") callback(); });
    return this;
  });
  const root = mkdtempSync(join(tmpdir(), "kota-recovery-history-"));
  const stateDir = join(root, ".kota");
  const preflightTimes: number[] = [];
  let dispatchedAt = 0;
  const workflows = [0, 1, 2].map((index) => registerWorkflowDefinition(`test/preflight-${index}.ts`, {
    name: `preflight-${index}`, repository: "none", triggers: [{ event: "manual" }],
    steps: [inspectTargetTaskStep, { id: "agent-preflight-reached", type: "code", run: (ctx) => {
      if (!inspectTargetTaskStep.outputRequired(ctx).actionable) throw new Error("Expected actionable task");
      preflightTimes.push(performance.now() - dispatchedAt);
      return "agent preflight reached";
    } }],
  }));
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  mkdirSync(join(root, ".kota/runs/relevant"), { recursive: true });
  mkdirSync(join(root, ".kota/eval-runs"), { recursive: true });
  for (const index of [0, 1, 2]) writeFileSync(join(root, `data/tasks/task-history-${index}.md`),
    `---\nstatus: open\npriority: p1\n---\n# History ${index}\n\nEvidence: .kota/runs/relevant\n`);
  writeFileSync(join(root, ".gitignore"), ".kota/\n");
  const git = (...args: string[]) => childProcess.execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=KOTA Test", "-c", "user.email=kota@example.test", "add", ".");
  git("-c", "user.name=KOTA Test", "-c", "user.email=kota@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  for (let index = 0; index < 70; index++) writeFileSync(join(root, `.kota/runs/relevant/${index}.json`),
    JSON.stringify({ source: "contained-probe", outcome: "pass", predicate: index }));
  const authorityConfigPath = join(stateDir, "authority.json");
  writeFileSync(authorityConfigPath, JSON.stringify({ trustedScopes: [root] }));
  const daemon = new Daemon({ scopeRoot: root, authorityConfigPath, workflows,
    config: { scheduler: { concurrency: 3 } }, idleIntervalMs: 60_000 });
  const running = daemon.start();
  let database: RunStateDatabase | undefined;
  try {
    await daemon.whenReady();
    database = RunStateDatabase.openExisting(stateDir);
    const scopeId = daemon.getScopeRegistryProjection().defaultScopeId;
    const epoch = database.getEpoch();
    const selected = { task: { id: "task-history-0", body: "Evidence .kota/runs/relevant" }, runIds: [] };
    const measurements = [];
    for (const historyRuns of [0, 3_452]) {
      for (let index = 0; index < historyRuns; index++) {
        const id = `history-${index}`;
        database.admitRun({ id, scopeId, workflow: "historical", repository: "none", resources: [],
          trigger: { event: "manual", schemaRef: null, payload: { taskId: `task-unrelated-${index}` } },
          admittedAt: "2026-09-10T00:00:00.000Z" });
        database.startRun(id, epoch, "2026-09-10T00:00:01.000Z");
        database.finishRun(id, epoch, "succeeded", "2026-09-10T00:00:02.000Z");
        const directory = join(stateDir, "runs", id);
        mkdirSync(directory);
        for (let file = 0; file < 11; file++) writeFileSync(join(directory, `${file}.json`),
          JSON.stringify({ taskId: `task-unrelated-${index}`, source: "unrelated", outcome: "pass" }));
      }
      const spawn = vi.spyOn(childProcess, "spawn");
      syncBuiltinESMExports();
      const started = performance.now();
      const evidence = await collectBlockedEvidence(root, ".kota/runs", [], selected);
      measurements.push({ historyRuns, historyJsonFiles: historyRuns * 11,
        elapsedMs: performance.now() - started, leafReads: evidence.artifacts.length, helperLaunches: spawn.mock.calls.length });
      spawn.mockRestore();
      syncBuiltinESMExports();
      expect(evidence.artifacts, evidence.unavailable.join("\n")).toHaveLength(70);
    }
    expect(measurements.map((value) => value.helperLaunches)).toEqual([2, 2]);
    expect(database.readWorkflowSummary(scopeId).completedRuns).toBe(3_452);
    const address: { token: string } = JSON.parse(readFileSync(join(stateDir, "daemon-control.json"), "utf8"));
    const request = async (path: string, body?: object) => {
      if (!controlServer) throw new Error("Control server has not started");
      const input = new IncomingMessage(new Socket());
      input.url = path;
      input.method = body ? "POST" : "GET";
      input.headers = { authorization: `Bearer ${address.token}`, "content-type": "application/json" };
      const response = new ServerResponse(input);
      let output = "";
      const socket = new Socket();
      socket._write = (chunk, _encoding, callback) => { output += chunk.toString(); callback(); };
      socket._writev = (chunks, callback) => { output += chunks.map(({ chunk }) => chunk.toString()).join(""); callback(); };
      response.assignSocket(socket);
      const finished = new Promise<void>((resolve, reject) => {
        response.once("finish", resolve);
        response.once("error", reject);
      });
      controlServer.emit("request", input, response);
      if (body) input.push(JSON.stringify(body));
      input.push(null);
      await finished;
      expect(response.statusCode, output).toBe(200);
    };
    const tasks = listBuilderTaskDispatches(root);
    dispatchedAt = performance.now();
    await Promise.all(tasks.map((payload, index) => request("/workflow/trigger", { name: `preflight-${index}`, payload })));
    const latencies: number[] = [];
    while (preflightTimes.length < 3 && performance.now() - dispatchedAt < 15_000) {
      const started = performance.now();
      await request("/workflow/status");
      await request("/health");
      latencies.push(performance.now() - started);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(preflightTimes, JSON.stringify([0, 1, 2].flatMap((index) => database!.listRuns(scopeId, undefined, { workflow: `preflight-${index}` })))
      ).toHaveLength(3);
    expect(Math.max(...preflightTimes)).toBeLessThan(15_000);
    expect(Math.max(...latencies)).toBeLessThan(1_000);
    process.stdout.write(`${JSON.stringify({ recoveryEvidenceMeasurement: { measurements,
      concurrentPreflights: 3, preflightTimesMs: preflightTimes,
      controlRequestPairs: latencies.length, maxControlPairMs: Math.max(...latencies),
      totalConcurrentElapsedMs: performance.now() - dispatchedAt,
    } })}\n`);
  } finally {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    database?.close();
    await daemon.stop(1_000, "programmatic", 1_000);
    await running;
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);

// Detects detached evidence workers in retained recovery: no active workflow
// step exists to supply cancellation, so the real coordinator must own it.
it.each(["run", "scope", "shutdown"] as const)("stops retained builder collection on %s cancellation", async (cancellation) => {
  const root = mkdtempSync(join(tmpdir(), "kota-retained-cancel-"));
  const stateDir = join(root, ".kota");
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  writeFileSync(join(root, "data/tasks/task-target.md"), "---\nstatus: open\npriority: p1\n---\n# Requires execution evidence\n\nCollect task-attributable execution results.\n");
  writeFileSync(join(root, ".gitignore"), ".kota/\n");
  const git = (...args: string[]) => childProcess.execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=KOTA Test", "-c", "user.email=kota@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
  const evidenceDir = join(stateDir, "eval-runs/task-target");
  mkdirSync(evidenceDir, { recursive: true });
  for (let index = 0; index < 70; index++) writeFileSync(join(evidenceDir, `${index}.json`),
    JSON.stringify({ taskId: "task-target", execution: { kind: "contained" }, exitCode: 0, predicate: index }));
  const database = new RunStateDatabase(stateDir);
  database.registerScope({ id: "scope", rootPath: root, createdAt: new Date().toISOString() });
  const coordinator = new RunCoordinator({ store: database, daemonEpoch: database.getEpoch(), concurrency: 1,
    execute: async () => { throw new Error("Cancelled recovery must not execute"); } });
  const progress: string[] = [];
  let stop: Promise<void> | undefined;
  let cancelled = false;
  let returnedCollection = false;
  const definition = validateWorkflowDefinitions([registerWorkflowDefinition("test/retained.ts", {
    name: "builder", repository: "read", triggers: [{ event: "manual" }],
    resources: () => ["task:task-target"], steps: [{ id: "noop", type: "code", run: () => undefined }],
    recovery: async (input) => {
      const observed = { ...input, reportProgress: (event: { label?: string }) => {
        progress.push(event.label ?? "");
        if (cancelled) return;
        cancelled = true;
        if (cancellation === "run") expect(coordinator.cancel(input.runId)).toEqual({ cancelled: true });
        else if (cancellation === "scope") expect(coordinator.cancelScope(input.scopeId)).toBe(1);
        else stop = coordinator.dispose();
      } };
      const result = await assessBuilderRecovery(observed);
      returnedCollection = true;
      return result;
    },
  })], root)[0]!;
  const queue = new WorkflowQueueManager({ store: new WorkflowRunStore(root), runState: database, coordinator,
    scopeId: "scope", scopeRoot: root, getScopeId: () => "scope", getActiveBackoff: () => null,
    workflowUsesAgent: () => false, getDefinitions: () => [definition], log: () => undefined });
  const runId = "retained-builder";
  database.admitRun({ id: runId, scopeId: "scope", workflow: "builder", repository: "read",
    resources: ["task:task-target"], admittedAt: new Date().toISOString(),
    trigger: { event: "manual", schemaRef: null, payload: listBuilderTaskDispatches(root)[0]! } });
  database.requireRunAttention(runId, "awaiting evidence", []);
  try {
    const pending = queue.resumeRetainedRun(runId, Date.now());
    expect(queue.resumeRetainedRun(runId, Date.now())).toBe(pending);
    expect(await pending).toBe(false);
    await stop;
    expect(cancelled).toBe(true);
    expect(returnedCollection).toBe(false);
    expect(progress).toContainEqual(expect.stringContaining("Selected"));
    expect(progress).not.toContain("Collected 70 of 70 selected evidence files");
    expect(database.getRun(runId)?.state).toBe(cancellation === "shutdown" ? "needs_attention" : "cancelled");
    expect(coordinator.activeCount).toBe(0);
    process.stdout.write(`${JSON.stringify({ retainedRecoveryCancellation: { cancellation, progress,
      returnedCollection, state: database.getRun(runId)?.state } })}\n`);
  } finally {
    await coordinator.dispose();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
