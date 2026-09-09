import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import dispatcher from "#modules/autonomy/workflows/dispatcher/workflow.js";
import { decodeExplorerState, EXPLORER_STATE_KEY, type ExplorerState } from "#modules/autonomy/workflows/explorer/explorer-state.js";
import explorer from "#modules/autonomy/workflows/explorer/workflow.js";
import explorerPublication from "#modules/autonomy/workflows/explorer-publication/workflow.js";
import { runGitEvidenceCommand } from "#modules/autonomy/workflows/git-evidence-test-support.js";
import { scopePolicySnapshotForTest } from "#modules/autonomy/workflows/scope-improver/scope-policy-test-support.js";
import { renderDashboard } from "#modules/daemon-ops/dashboard.js";
import { makeSnapshot, stripAnsi } from "#modules/daemon-ops/dashboard-test-support.js";
import { DaemonTaskQueueProjection } from "#modules/daemon-ops/task-queue-projection.js";
import { listRepoTasks } from "#modules/repo-tasks/repo-tasks-operations.js";
import webAccess from "#modules/web-access/index.js";

const roots: string[] = [];
afterEach(() => { clearCustomTools(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// Consumer: builder/explorer and operators. Owners: repo-tasks + runtime + dispatcher.
// Stimulus: idle dispatch and task list. Oracle: emitted contracts, supply, atomic claim.
// Distinct failure: retained ownership masquerades as runnable work. Cadence: integration.
it("dispatches only independent unclaimed work while preserving retained owners and atomic claims", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-work-supply-"));
  roots.push(root);
  const stateDir = join(root, ".kota");
  const scopeId = deriveDirectoryScopeId(root);
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".kota/\n");
  writeFileSync(join(root, "data/watchlist.yaml"), "resources:\n  - url: https://example.com/research\n    added: 2026-09-01\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--quiet");
  const writeTask = (id: string, state = "open", dependsOn: string[] = []) => {
    writeFileSync(join(root, "data/tasks", `${id}.md`),
      `---\nstatus: ${state}\npriority: p2\ndepends_on: [${dependsOn.join(", ")}]\n---\n# ${id}\n`);
  };
  const commitInput = () => {
    git("add", "data", ".gitignore");
    git("-c", "user.name=KOTA Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "scenario input");
  };
  const database = new RunStateDatabase(stateDir);
  writeTask("task-a");
  expect(listRepoTasks(root).workSupply).toMatchObject({ ownershipAvailable: false, availableCount: 0 });
  const dashboard = new DaemonTaskQueueProjection(root);
  const renderWorkSupply = async () => {
    await dashboard.refresh(new AbortController().signal);
    return stripAnsi(renderDashboard(makeSnapshot({ taskQueue: dashboard.getSnapshot() }), [], { width: 160 }));
  };
  const unknownDashboard = await renderWorkSupply();
  expect(unknownDashboard).toContain("Availability unknown");
  expect(unknownDashboard).not.toContain("dispatchable work available");
  database.registerScope({ id: scopeId, rootPath: root, createdAt: new Date().toISOString() });
  const { epoch } = database.beginDaemonSession(new Date().toISOString());
  const evidence = new WorkflowRunStore(root);
  for (const id of ["task-a", "task-b", "task-c", "task-d"]) {
    writeTask(id);
    database.admitRun({ id: `run-${id}`, scopeId, workflow: "builder", repository: "write",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: id } },
      resources: [`task:${id}`], admittedAt: new Date().toISOString() });
    evidence.createRun({
      name: "builder", enabled: true, repository: "write", tags: [],
      integration: { validationCommand: ["pnpm", "validate-tasks"] },
      definitionPath: "retained-builder.scenario.ts", moduleRoot: root,
      triggers: [], steps: [{ id: "build", type: "code", run: () => undefined }],
    }, { event: "autonomy.queue.available", schemaRef: null, payload: { taskId: id } }, `run-${id}`)
      .finish({ status: "failed", durationMs: 1, error: "Retained integration recovery" });
    database.startRun(`run-${id}`, epoch, new Date().toISOString());
    database.suspendRun({ runId: `run-${id}`, epoch, state: "needs_attention", suspendedAt: new Date().toISOString() });
  }
  database.close();
  commitInput();
  const retainedDashboard = await renderWorkSupply();
  expect(retainedDashboard).toContain("Dispatchable 0  Available 0  Running 0  Queued 0  Retained 4");
  expect(retainedDashboard).toContain("retained task ownership; no dispatchable tasks");
  expect(retainedDashboard).not.toContain("dispatchable work available");
  process.stdout.write(`Foreground dashboard: isolated four-retained-owner fixture\n${retainedDashboard}\n`);
  const dispatch = () => new WorkflowScenarioDriver(dispatcher, {
    workspaceRoot: root,
    scopePolicySnapshot: scopePolicySnapshotForTest(root),
    trigger: { event: "runtime.idle", payload: {} },
    ports: { state: { stateDir, scopeId }, runCommand: runGitEvidenceCommand },
  }).run();
  const retained = await dispatch();
  expect(retained.status, retained.error).toBe("success");
  expect(retained.steps["assess-and-dispatch"].output).toMatchObject({
    actionableCount: 4, availableCount: 0, retainedCount: 4, runningCount: 0,
    builderTaskIds: [], queueDecision: { empty: true, explorationEligible: true },
  });
  expect(retained.emitted.some((event) => event.event === "autonomy.queue.available")).toBe(false);
  expect(retained.emitted.some((event) => event.event === "autonomy.queue.empty")).toBe(true);

  writeTask("task-independent");
  writeTask("task-external", "blocked");
  writeTask("task-dependent", "open", ["task-external"]);
  commitInput();
  const mixedDashboard = await renderWorkSupply();
  expect(mixedDashboard).toContain("Dispatchable 1  Available 1  Running 0  Queued 0  Retained 4");
  expect(mixedDashboard).toContain("dispatchable work available");
  const mixed = await dispatch();
  expect(mixed.status, mixed.error).toBe("success");
  expect(mixed.emitted.filter((event) => event.event === "autonomy.queue.available").map((event) => event.payload.taskId))
    .toEqual(["task-independent"]);
  expect(mixed.emitted.some((event) => event.event === "autonomy.queue.thin")).toBe(true);
  expect(listRepoTasks(root).workSupply).toMatchObject({
    availableTaskIds: ["task-independent"], retainedCount: 4,
    dependencyBlockedTasks: [{ id: "task-dependent", waitingOn: ["task-external"] }],
  });

  const thin = mixed.emitted.find((event) => event.event === "autonomy.queue.thin")!;
  if (!Array.isArray(webAccess.tools)) throw new Error("Expected bundled web tool declarations");
  const fetchTool = webAccess.tools.find((tool) => tool.tool.name === "web_fetch")!;
  registerTool(fetchTool.tool, fetchTool.runner, "work-supply-test", { effect: fetchTool.effect });
  let sourceReads = 0;
  const explore = () => new WorkflowScenarioDriver(explorer, {
    workspaceRoot: root,
    trigger: { event: thin.event, payload: thin.payload },
    stepOutputs: { explore: "No action: the observed capability is already represented by current tasks. Revisit when the source reports new recovery evidence." },
    ports: {
      state: { stateDir, scopeId }, runCommand: successfulWorkflowCommandRun,
      runTool: async () => { sourceReads++; return { content: "Durable task ownership survives restart." }; },
    },
  }).run();
  const firstReview = await explore();
  expect(firstReview.status, firstReview.error).toBe("success");
  expect(firstReview.steps.explore.status).toBe("success");
  const publication = firstReview.emitted.find((event) => event.event === "autonomy.explorer.publication.requested")!;
  const published = await new WorkflowScenarioDriver(explorerPublication, {
    workspaceRoot: root, trigger: { event: publication.event, payload: publication.payload },
    ports: { state: { stateDir, scopeId } },
  }).run();
  expect(published.status, published.error).toBe("success");
  const elapsed = "2026-09-01T00:00:00.000Z";
  const observationStore = RunStateDatabase.openExisting(stateDir);
  try {
    const stored = observationStore.readScopeStateValue<ExplorerState>(scopeId, EXPLORER_STATE_KEY);
    const current = decodeExplorerState(stored.value);
    observationStore.compareAndSetScopeStateValue({ scopeId, key: EXPLORER_STATE_KEY,
      expectedRevision: stored.revision, updatedAt: new Date().toISOString(), value: {
        ...current, observedAt: elapsed, lastExplorationAt: elapsed,
        sources: Object.fromEntries(Object.entries(current.sources).map(([url, source]) => [url, { ...source, checkedAt: elapsed }])),
      } });
  } finally { observationStore.close(); }
  const unchangedReview = await explore();
  expect(unchangedReview.status, unchangedReview.error).toBe("success");
  expect(sourceReads).toBe(2);
  expect(unchangedReview.steps.explore.status).toBe("skipped");
  expect(unchangedReview.steps["record-exploration-publication"].output).toMatchObject({
    reviewed: false, lastExplorationAt: elapsed,
  });

  const resumed = RunStateDatabase.openExisting(stateDir);
  try {
    const { epoch: nextEpoch } = resumed.beginDaemonSession(new Date().toISOString());
    const admit = (runId: string, taskId: string) => resumed.admitRun({
      id: runId, scopeId, workflow: "builder", repository: "write",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId } },
      resources: [`task:${taskId}`], admittedAt: new Date().toISOString(),
    });
    admit("duplicate", "task-a");
    expect(resumed.startRun("duplicate", nextEpoch, new Date().toISOString())).toBeNull();
    expect(resumed.getRun("run-task-a")?.state).toBe("needs_attention");
    admit("independent", "task-independent");
    expect(resumed.startRun("independent", nextEpoch, new Date().toISOString())).toBe(1);
    expect(listRepoTasks(root).workSupply.availableCount).toBe(0);
    resumed.finishRun("independent", nextEpoch, "succeeded", new Date().toISOString());
    // The unmodified open intent becomes available again only after runtime release.
    expect(listRepoTasks(root).workSupply.availableTaskIds).toEqual(["task-independent"]);
  } finally { resumed.close(); }
});
