import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { assembleUiSurfaceBundle } from "#core/modules/module-ui-surfaces.js";
import { OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { clearCustomTools, deregisterTool, registerTool } from "#core/tools/index.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { AGENT_OK_RESULT } from "#core/workflow/run-executor-test-fixture.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import * as workflowCommands from "#core/workflow/workflow-command.js";
import { collectAutonomyContinuationContext } from "#modules/autonomy/continuation.js";
import { resolveAvailableBuilderWork } from "#modules/autonomy/workflows/builder/available-work.js";
import { builderTaskResources, listBuilderTaskDispatches, readBuilderTaskPayload } from "#modules/autonomy/workflows/builder/task-contract.js";
import dispatcher from "#modules/autonomy/workflows/dispatcher/workflow.js";
import { decodeExplorerState, EXPLORER_STATE_KEY, type ExplorerState } from "#modules/autonomy/workflows/explorer/explorer-state.js";
import type { refreshExplorerSources } from "#modules/autonomy/workflows/explorer/source-evidence.js";
import explorer from "#modules/autonomy/workflows/explorer/workflow.js";
import { runGitEvidenceCommand } from "#modules/autonomy/workflows/git-evidence-test-support.js";
import { scopePolicySnapshotForTest } from "#modules/autonomy/workflows/scope-improver/scope-policy-test-support.js";
import { renderDashboard } from "#modules/daemon-ops/dashboard.js";
import { makeSnapshot, stripAnsi } from "#modules/daemon-ops/dashboard-test-support.js";
import { DaemonTaskQueueProjection } from "#modules/daemon-ops/task-queue-projection.js";
import { REPO_INBOX_RESOURCE } from "#modules/repo-tasks/repo-tasks-domain.js";
import { listRepoTasks, showTask } from "#modules/repo-tasks/repo-tasks-operations.js";
import { handleTaskStatus } from "#modules/repo-tasks/routes-state-handlers.js";
import { mockResponse } from "#modules/repo-tasks/routes-test-helpers.js";
import { repoTasksUiSurfaceSource } from "#modules/repo-tasks/ui-surface.js";
import webAccess from "#modules/web-access/index.js";

// Socket availability is controlled; runtime allocation and ownership stay real.
vi.mock("node:net", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:net")>(),
  createServer: () => {
    const server = {
      unref: () => server,
      once: () => server,
      listen: (_options: unknown, listening: () => void) => { listening(); return server; },
      close: (closed: () => void) => { closed(); return server; },
    };
    return server;
  },
}));

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); clearCustomTools(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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
  const sourceUrls = ["oversized", "inaccessible", "research", "unusable", "streaming-oversized"].map((path) => `https://example.com/${path}`);
  writeFileSync(join(root, "data/watchlist.yaml"), `resources:\n${sourceUrls.map((url) => `  - url: ${url}\n    added: 2026-09-01\n`).join("")}`);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--quiet");
  const writeTask = (id: string, state = "open", dependsOn: string[] = []) => {
    writeFileSync(join(root, "data/tasks", `${id}.md`),
      `---\nstatus: ${state}\npriority: p2\ndepends_on: [${dependsOn.join(", ")}]\n---\n# ${id}\n\nPreserve exclusive ownership while independent work is dispatched.\n${state === "blocked" ? "\n## Blocked on\nkind: operator-capture\npath: evidence/operator-run.txt\ndescription: Await the operator runtime evidence.\n" : ""}`);
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
  expect(listRepoTasks(root)).toMatchObject({
    tasks: [expect.objectContaining({ id: "task-a" })],
    workSupply: { headSha: "", ownershipAvailable: true, availableTaskIds: [], availableCount: 0 },
  });
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
  mkdirSync(join(root, "data/inbox"));
  writeFileSync(join(root, "data/inbox/held.md"), "Preserve this retained capture");
  database.admitRun({ id: "held-inbox", scopeId, workflow: "inbox-sorter", repository: "write",
    trigger: { event: "manual", schemaRef: null, payload: {} },
    resources: [REPO_INBOX_RESOURCE], admittedAt: new Date().toISOString() });
  evidence.createRun({
    name: "inbox-sorter", enabled: true, repository: "write", tags: [],
    integration: { validationCommand: ["pnpm", "validate-tasks"] },
    definitionPath: "retained-inbox.scenario.ts", moduleRoot: root,
    triggers: [], steps: [{ id: "sort", type: "code", run: () => undefined }],
  }, { event: "manual", schemaRef: null, payload: {} }, "held-inbox")
    .finish({ status: "failed", durationMs: 1, error: "Retained priority yield" });
  database.startRun("held-inbox", epoch, new Date().toISOString());
  database.suspendRun({ runId: "held-inbox", epoch, state: "waiting", suspendedAt: new Date().toISOString() });
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
  expect(listRepoTasks(root).workSupply).toMatchObject({
    actionableCount: 4, availableCount: 0, retainedCount: 4, runningCount: 0,
    availableTaskIds: [], hasDispatchableWork: false,
    inboxCount: 1, dispatchableCount: 0,
  });
  expect(retained.emitted.some((event) => event.event === "autonomy.queue.available")).toBe(false);
  expect(retained.emitted.some((event) => event.event === "autonomy.queue.empty")).toBe(true);

  writeTask("task-independent");
  writeTask("task-external", "blocked");
  writeTask("task-dependent", "open", ["task-external"]);
  commitInput();
  const publishedSupply = listRepoTasks(root).workSupply;
  rmSync(join(root, "data/tasks/task-independent.md"));
  writeTask("task-external");
  writeTask("task-dependent");
  writeFileSync(join(root, "data/tasks/task-draft.md"), "---\nstatus: open\npriority: p1\n---\n# Unfinished draft\n\n<!-- intent still being edited -->\n");
  mkdirSync(join(root, "data/inbox"), { recursive: true });
  writeFileSync(join(root, "data/inbox/draft.md"), "Unpublished inbox capture");
  const workingList = listRepoTasks(root);
  expect(workingList.workSupply).toEqual(publishedSupply);
  expect(workingList.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "task-draft", title: "Unfinished draft" }),
    expect.objectContaining({ id: "task-external", state: "open" }),
    expect.objectContaining({ id: "task-dependent", waitingOnTasks: [] }),
  ]));
  expect(workingList.tasks.some(({ id }) => id === "task-independent")).toBe(false);
  expect(showTask(root, "task-draft")).toMatchObject({ found: true, content: expect.stringContaining("intent still being edited") });
  const status = mockResponse();
  await handleTaskStatus(status.res, root);
  expect(status.result).toMatchObject({ status: 200, body: {
    counts: { inbox: 2, open: 7, blocked: 0 },
    tasks: { open: expect.arrayContaining([expect.objectContaining({ id: "task-draft" })]) },
    workSupply: publishedSupply,
  } });
  const ui = await assembleUiSurfaceBundle(root, [{ moduleName: "repo-tasks", source: repoTasksUiSurfaceSource }], {
    selector: { scopeId },
    client: createKotaClientTestDouble({ tasks: { list: async (states) => listRepoTasks(root, states) } }),
  });
  expect(ui.surfaces[0].nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "status-summary", entries: expect.arrayContaining([expect.objectContaining({ label: "Available", value: "1" })]) }),
    expect.objectContaining({ kind: "table", rows: expect.arrayContaining([expect.objectContaining({ id: "task-draft" })]) }),
  ]));
  const mixedDashboard = await renderWorkSupply();
  expect(dashboard.getSnapshot()).toEqual(publishedSupply);
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

  writeTask("task-independent");
  writeTask("task-external", "blocked");
  writeTask("task-dependent", "open", ["task-external"]);
  rmSync(join(root, "data/tasks/task-draft.md"));
  rmSync(join(root, "data/inbox/draft.md"));

  const thin = mixed.emitted.find((event) => event.event === "autonomy.queue.thin")!;
  if (!Array.isArray(webAccess.tools)) throw new Error("Expected bundled web tool declarations");
  const fetchTool = webAccess.tools.find((tool) => tool.tool.name === "web_fetch")!;
  registerTool(fetchTool.tool, fetchTool.runner, "work-supply-test", { effect: fetchTool.effect });
  let sourceReads = 0;
  let article = "Durable task ownership survives restart.";
  let researchUnavailable = false;
  const head = `<head><title>Runtime research</title><script>const layout = '<article>${"preload ".repeat(30)}</article>';</script>${'<link rel="preload" href="/layout.css">'.repeat(2600)}</head>`;
  const unusable = '<html><head><title>Runtime research</title><script>unfinished layout';
  const transport = new OutboundHttpTransport({
    resolveAddresses: async () => [{ address: "93.184.216.34", family: 4 }],
    dispatcher: async (url) => {
      sourceReads++;
      if (url.pathname === "/oversized") {
        return new Response("", { headers: { "content-type": "text/html", "content-length": "1048577" } });
      }
      if (url.pathname === "/inaccessible") return new Response("Unavailable", { status: 503, statusText: "Service Unavailable" });
      if (url.pathname === "/streaming-oversized") {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(head));
            controller.enqueue(new Uint8Array(1_048_576));
            controller.close();
          },
        }), { headers: { "content-type": "text/html" } });
      }
      const html = url.pathname === "/unusable" || researchUnavailable
        ? unusable
        : `<html>${head}<body><article><h1>Recovery research</h1><p>${article}</p></article></body></html>`;
      return new Response(html, { headers: { "content-type": "text/html", "content-length": String(Buffer.byteLength(html)) } });
    },
  });
  vi.spyOn(outboundHttp, "request").mockImplementation((request) => transport.request(request));
  let explorationRuns = 0;
  let sourceReviews = 0;
  const explore = () => {
    const runId = `source-review-${++explorationRuns}`;
    return new WorkflowScenarioDriver(explorer, {
      runId,
      workspaceRoot: root,
      trigger: { event: thin.event, payload: thin.payload },
      ports: {
        state: { stateDir, scopeId }, runCommand: successfulWorkflowCommandRun,
        runTool: "registered",
        runAgent: () => {
          const metadata = readWorkflowRunMetadataFile(join(root, ".kota/runs", runId, "metadata.json"));
          const inspection = metadata?.steps.find((step) => step.id === "inspect-watchlist")?.output as Awaited<ReturnType<typeof refreshExplorerSources>>;
          expect(inspection.observations).toHaveLength(sourceUrls.length);
          for (const source of inspection.observations) {
            expect(readFileSync(source.contentPath, "utf8")).toBe(readFileSync(source.evidencePath, "utf8"));
          }
          const research = inspection.observations.find((source) => source.url === sourceUrls[2])!;
          expect(research.accessible).toBe(true);
          expect(readFileSync(research.contentPath, "utf8")).toContain(article);
          expect(readFileSync(research.contentPath, "utf8")).not.toContain("preload");
          sourceReviews++;
          return "No action: the observed capability is already represented by current tasks. Revisit when the source reports new recovery evidence.";
        },
      },
    }).run();
  };
  const firstReview = await explore();
  expect(firstReview.status, firstReview.error).toBe("success");
  expect(firstReview.steps.explore.status).toBe("success");
  const sourceEvidence = firstReview.steps["inspect-watchlist"].output as Awaited<ReturnType<typeof refreshExplorerSources>>;
  expect(sourceEvidence.shouldReview).toBe(true);
  expect(sourceEvidence.observations).toEqual([
    expect.objectContaining({ url: sourceUrls[1], accessible: false, changed: false }),
    expect.objectContaining({ url: sourceUrls[0], accessible: false, changed: false }),
    expect.objectContaining({ url: sourceUrls[2], accessible: true, changed: true }),
    expect.objectContaining({ url: sourceUrls[4], accessible: false, changed: false }),
    expect.objectContaining({ url: sourceUrls[3], accessible: false, changed: false }),
  ]);
  expect(readFileSync(sourceEvidence.observations[0].evidencePath, "utf8")).toBe("HTTP 503 Service Unavailable");
  expect(readFileSync(sourceEvidence.observations[1].evidencePath, "utf8")).toContain("response-too-large");
  expect(readFileSync(sourceEvidence.observations[3].evidencePath, "utf8")).toContain("response-too-large");
  expect(readFileSync(sourceEvidence.observations[4].evidencePath, "utf8")).toContain("no readable source content");
  expect(readFileSync(sourceEvidence.observations[4].evidencePath, "utf8")).toContain("Runtime research");
  expect(readFileSync(sourceEvidence.observations[2].evidencePath, "utf8")).toContain(article);
  const publishAndMakeRecheckDue = async (review: typeof firstReview) => {
    expect(review.status, review.error).toBe("success");
    const observationStore = RunStateDatabase.openExisting(stateDir);
    try {
      const stored = observationStore.readScopeStateValue<ExplorerState>(scopeId, EXPLORER_STATE_KEY);
      const current = decodeExplorerState(stored.value);
      expect(current.sources[sourceUrls[0]].fingerprint).toBeNull();
      expect(current.sources[sourceUrls[1]].fingerprint).toBeNull();
      expect(current.sources[sourceUrls[2]].fingerprint).not.toBeNull();
      expect(current.sources[sourceUrls[3]].fingerprint).toBeNull();
      expect(current.sources[sourceUrls[4]].fingerprint).toBeNull();
      expect(current.lastReviewedFingerprint).not.toBeNull();
      observationStore.compareAndSetScopeStateValue({ scopeId, key: EXPLORER_STATE_KEY,
        expectedRevision: stored.revision, updatedAt: new Date().toISOString(), value: {
          ...current, observedAt: elapsed, lastExplorationAt: elapsed,
          sources: Object.fromEntries(Object.entries(current.sources).map(([url, source]) => [url, { ...source, checkedAt: elapsed }])),
        } });
      return current;
    } finally { observationStore.close(); }
  };
  const elapsed = "2026-09-01T00:00:00.000Z";
  await publishAndMakeRecheckDue(firstReview);
  const unchangedReview = await explore();
  expect(unchangedReview.status, unchangedReview.error).toBe("success");
  expect(sourceReads).toBe(2 * sourceUrls.length);
  expect(sourceReviews).toBe(1);
  expect(unchangedReview.steps.explore.status).toBe("skipped");
  expect(unchangedReview.steps["record-exploration-publication"].output).toMatchObject({
    reviewed: false, lastExplorationAt: elapsed,
  });

  await publishAndMakeRecheckDue(unchangedReview);
  article += " New recovery evidence shows cancelled writers retain their resources until settlement.";
  const changedReview = await explore();
  expect(changedReview.status, changedReview.error).toBe("success");
  expect(changedReview.steps.explore.status).toBe("success");
  expect(sourceReviews).toBe(2);
  const changedState = await publishAndMakeRecheckDue(changedReview);
  expect(changedState.sources[sourceUrls[2]].fingerprint).not.toBe(sourceEvidence.sources[sourceUrls[2]].fingerprint);

  researchUnavailable = true;
  const unusableReview = await explore();
  expect(unusableReview.status, unusableReview.error).toBe("success");
  expect(unusableReview.steps.explore.status).toBe("skipped");
  const unusableEvidence = unusableReview.steps["inspect-watchlist"].output as typeof sourceEvidence;
  expect(unusableEvidence.sources[sourceUrls[2]].fingerprint).toBe(changedState.sources[sourceUrls[2]].fingerprint);
  expect(unusableEvidence.observations.find((source) => source.url === sourceUrls[2])).toMatchObject({ accessible: false, changed: false });
  const unavailableState = await publishAndMakeRecheckDue(unusableReview);
  expect(unavailableState.lastReviewedFingerprint).toBe(changedState.lastReviewedFingerprint);

  researchUnavailable = false;
  const restoredReview = await explore();
  expect(restoredReview.status, restoredReview.error).toBe("success");
  expect(restoredReview.steps.explore.status).toBe("skipped");
  expect(sourceReviews).toBe(2);
  expect(sourceReads).toBe(5 * sourceUrls.length);
  await publishAndMakeRecheckDue(restoredReview);

  deregisterTool("web_fetch");
  const unavailableRunner = await explore();
  expect(unavailableRunner.status).toBe("failed");
  expect(unavailableRunner.steps["inspect-watchlist"].error).toContain("has no registered effect");
  expect(unavailableRunner.emitted).toEqual([]);
  expect(sourceReads).toBe(5 * sourceUrls.length);

  const resumed = RunStateDatabase.openExisting(stateDir);
  try {
    const { epoch: nextEpoch } = resumed.beginDaemonSession(new Date().toISOString());
    const admit = (runId: string, taskId: string) => resumed.admitRun({
      id: runId, scopeId, workflow: "builder", repository: "write",
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: { taskId } },
      resources: [`task:${taskId}`], admittedAt: new Date().toISOString(),
    });
    expect(() => admit("duplicate", "task-a")).toThrow('Resources are held by retained run "run-task-a"');
    expect(resumed.getRun("duplicate")).toBeNull();
    expect(resumed.getRun("run-task-a")?.state).toBe("needs_attention");
    admit("independent", "task-independent");
    admit("competing", "task-independent");
    expect(resumed.startRun("independent", nextEpoch, new Date().toISOString())).toBe(1);
    expect(resumed.startRun("competing", nextEpoch, new Date().toISOString())).toBeNull();
    expect(resumed.cancelQueuedRun("competing", new Date().toISOString())).toBe(true);
    expect(listRepoTasks(root).workSupply.availableCount).toBe(0);
    resumed.finishRun("independent", nextEpoch, "succeeded", new Date().toISOString());
    // The unmodified open intent becomes available again only after runtime release.
    expect(listRepoTasks(root).workSupply.availableTaskIds).toEqual(["task-independent"]);
  } finally { resumed.close(); }

  // Continue the same supply journey through event admission and automatic slot
  // refill. This read-only consumer isolates scheduling from model-dependent
  // implementation: it uses builder's immutable contract/resource binding but
  // does not pretend that a controlled completion implements a real task.
  writeTask("task-next");
  writeTask("task-paused");
  commitInput();
  const refillDispatch = await dispatch();
  expect(refillDispatch.status, refillDispatch.error).toBe("success");
  const contracts = refillDispatch.emitted
    .filter((event) => event.event === "autonomy.queue.available")
    .map((event) => readBuilderTaskPayload(event.payload));
  expect(contracts.map(({ taskId }) => taskId)).toEqual(["task-independent", "task-next", "task-paused"]);
  const refillState = RunStateDatabase.openExisting(stateDir);
  const { epoch: refillEpoch } = refillState.beginDaemonSession(new Date().toISOString());
  const bus = new EventBus();
  const pbus = new ScopedEventBus(bus, scopeId);
  const releases = new Map<string, () => void>();
  const started: string[] = [];
  let runtime: WorkflowRuntime;
  const coordinator = new RunCoordinator({
    store: refillState, daemonEpoch: refillEpoch, concurrency: 1,
    execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
    deliverPublication: (publication) => runtime.deliverPublication(publication),
  });
  runtime = new WorkflowRuntime({
    bus, pbus, scopeRoot: root, scopeId,
    runState: refillState, runCoordinator: coordinator, daemonEpoch: refillEpoch,
    workflows: [{
      name: "work-supply-consumer", repository: "none",
      moduleRoot: process.cwd(), definitionPath: "work-supply-consumer.scenario.ts",
      resources: builderTaskResources,
      triggers: [{ event: "autonomy.queue.available", queueMode: "all" }],
      steps: [{ id: "consume", type: "code", run: async (ctx) => {
        const { taskId } = readBuilderTaskPayload(ctx.trigger.payload);
        started.push(taskId);
        await new Promise<void>((resolve) => { releases.set(taskId, resolve); });
        return { taskId };
      } }],
    }],
  });
  const consumerRuns = () => refillState.listRuns(scopeId)
    .filter((run) => run.workflow === "work-supply-consumer");
  runtime.start();
  try {
    for (const contract of contracts) pbus.emit("autonomy.queue.available", { ...contract, dependsOn: [...contract.dependsOn] });
    await expect.poll(() => started).toEqual(["task-independent"]);
    expect(consumerRuns().map(({ state }) => state).sort()).toEqual(["queued", "queued", "running"]);
    expect(listRepoTasks(root).workSupply).toMatchObject({ availableCount: 0, runningCount: 1, queuedCount: 2, retainedCount: 4 });
    for (const contract of contracts) {
      expect(consumerRuns().find((run) => run.trigger.payload.taskId === contract.taskId)?.trigger)
        .toMatchObject({ event: "autonomy.queue.available", payload: contract });
    }
    releases.get("task-independent")!();
    // No explicit refill or new idle event: completion must start the next run.
    await expect.poll(() => started).toEqual(["task-independent", "task-next"]);
    expect(consumerRuns().find((run) => run.trigger.payload.taskId === "task-independent")?.state).toBe("succeeded");
    expect(listRepoTasks(root).workSupply).toMatchObject({ availableCount: 1, runningCount: 1, queuedCount: 1, retainedCount: 4 });
    runtime.setDispatchPaused(true);
    releases.get("task-next")!();
    await coordinator.whenIdle();
    expect(started).toEqual(["task-independent", "task-next"]);
    expect(consumerRuns().find((run) => run.trigger.payload.taskId === "task-paused")?.state).toBe("queued");
    runtime.setDispatchPaused(false);
    await expect.poll(() => started).toEqual(["task-independent", "task-next", "task-paused"]);
    releases.get("task-paused")!();
    await coordinator.whenIdle();
    expect(consumerRuns().every((run) => run.state === "succeeded")).toBe(true);
    expect(listRepoTasks(root).workSupply).toMatchObject({ availableCount: 3, runningCount: 0, queuedCount: 0, retainedCount: 4 });
    expect(refillState.getRun("held-inbox")?.state).toBe("waiting");
    for (const id of ["task-a", "task-b", "task-c", "task-d"]) {
      expect(refillState.getRun(`run-${id}`)?.state).toBe("needs_attention");
    }
    process.stdout.write("Isolated slot refill: dispatcher contracts admitted 1 running / 2 queued; completion started the next contract; pause held the final contract until resume; all 4 retained task owners and the retained inbox owner survived. Consumer completion leaves task intent open.\n");
  } finally {
    coordinator.pauseGlobalAdmission();
    for (const release of releases.values()) release();
    await runtime.stop();
    await coordinator.dispose();
    refillState.close();
    bus.clear();
  }
});

// Consumer: deliberate priority yields. Owners: published task supply, trigger admission,
// coordinator and lifecycle. Detects unadmitted work losing the released slot, including
// a restart in that gap; stale supply must not become a permanent dependency.
it.each(["live", "restart", "blocked", "completed", "removed", "rejected", "disabled"] as const)(
  "hands a preserved slot to fresh admissible supply (%s)", async (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "kota-priority-handoff-"));
    roots.push(root);
    const stateDir = join(root, ".kota");
    const scopeId = deriveDirectoryScopeId(root);
    const now = () => new Date().toISOString();
    const taskPath = join(root, "data/tasks/task-urgent.md");
    mkdirSync(join(root, "data/tasks"), { recursive: true });
    writeFileSync(join(root, ".gitignore"), ".kota/\n");
    writeFileSync(join(root, "data/prompt.md"), "Complete the current task.\n");
    writeFileSync(taskPath, "---\nstatus: open\npriority: p1\n---\n# Urgent work\n\nRepair urgent behavior.\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "--quiet", "-b", "main");
    git("config", "user.name", "KOTA Test");
    git("config", "user.email", "test@example.com");
    const publish = () => { git("add", "data", ".gitignore"); git("commit", "--quiet", "-m", "published intent"); };
    publish();
    let database = new RunStateDatabase(stateDir);
    database.registerScope({ id: scopeId, rootPath: root, createdAt: now() });
    let epoch = database.beginDaemonSession(now()).epoch;
    const bus = new EventBus();
    const pbus = new ScopedEventBus(bus, scopeId);
    let runtime!: WorkflowRuntime;
    let coordinator!: RunCoordinator;
    const order: string[] = [];
    const sessions: Array<string | undefined> = [];
    const workspaces: string[] = [];
    let decisions = 0;
    let currentRunId = "";
    const harness = `priority-handoff-${scenario}`;
    registerAgentHarness({
      name: harness, description: "controlled model port for composed yield admission",
      supportsMultiTurn: true, supportedHookKinds: [], askOwnerToolName: null,
      emitsAgentMessageStream: true, toolControl: "native", nativeAbortQuarantine: "confirmed-stop",
      run: async (options) => {
        order.push("current");
        sessions.push(options.resumeSessionId);
        workspaces.push(options.cwd!);
        options.onSessionId?.("preserved-session");
        if (sessions.length === 1) writeFileSync(join(options.cwd!, "retained.txt"), "preserved progress\n");
        else expect(readFileSync(join(options.cwd!, "retained.txt"), "utf8")).toBe("preserved progress\n");
        writeFileSync(join(options.env!.KOTA_RUN_DIR, "commit-message.txt"), "Complete preserved priority work\n");
        options.abortQuarantine?.register(async () => {});
        await options.onMessage?.({ type: "text", text: "Progress checkpoint", sessionId: "preserved-session" });
        return AGENT_OK_RESULT;
      },
    });
    let validations = 0;
    // Control the validator subprocess port; real lifecycle, Git reconciliation and publication remain composed.
    vi.spyOn(workflowCommands, "createWorkflowCommandRunner").mockImplementation((options) => async (input) => {
      expect(input.command).toBe(process.execPath);
      expect(input.args).toEqual(["-e", "process.exit(0)"]);
      expect(readFileSync(join(input.cwd ?? options.cwd, "retained.txt"), "utf8")).toBe("preserved progress\n");
      validations++;
      return successfulWorkflowCommandRun({ ...input, cwd: input.cwd ?? options.cwd });
    });
    const start = () => {
      coordinator = new RunCoordinator({
        store: database, daemonEpoch: epoch, concurrency: 1,
        execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
        deliverPublication: (publication) => runtime.deliverPublication(publication),
      });
      runtime = new WorkflowRuntime({
        bus, pbus, scopeRoot: root, scopeId, runState: database, runCoordinator: coordinator, daemonEpoch: epoch,
        scopePolicyAuthority: { getSnapshot: () => scopePolicySnapshotForTest(root), subscribeRestrictiveChanges: () => () => {} },
        workflows: [{
          name: "priority-writer", repository: "write", moduleRoot: root,
          definitionPath: "priority-writer.scenario.ts", defaultAutonomyMode: "autonomous",
          integration: { validationCommand: [process.execPath, "-e", "process.exit(0)"] },
          resources: () => ["task:task-current"], triggers: [{ event: "current.ready" }],
          steps: [{ id: "work", type: "agent", promptPath: "data/prompt.md", harness, model: "test-model", effort: "high",
            repairLoop: {
              checks: [{ id: "complete", type: "code", run: () => "ok" }],
              continuation: {
                collectContext: () => collectAutonomyContinuationContext({
                  id: "task-current", priority: "p2", taskContract: "Finish current work",
                  workSupplyInput: { workspaceRoot: root, scopeRoot: root, stateDir, capacity: 1 },
                }),
                decide: (_ctx, _step, packet) => {
                  decisions++;
                  expect(packet.higherPriorityWork.map((item) => item.id)).toEqual(["task-urgent"]);
                  expect(database.listRuns(scopeId).some((run) => run.workflow === "supply-consumer")).toBe(false);
                  if (scenario !== "live") coordinator.pauseGlobalAdmission();
                  return { decision: "preserve-yield", rationale: "Preserve progress for urgent admissible work", nextAction: "Finish preserved progress" };
                },
                resolveAgentContract: (parent) => ({ harness: parent.harness, model: parent.model, effort: parent.effort,
                  autonomyMode: "autonomous", ownerQuestionAccess: "disabled" }),
              },
            },
          }],
        }, {
          name: "supply-consumer", repository: "none", moduleRoot: process.cwd(),
          definitionPath: "supply-consumer.scenario.ts", resources: builderTaskResources,
          availableWork: resolveAvailableBuilderWork, enabled: scenario !== "disabled",
          triggerAdmission: () => scenario === "rejected" ? { admitted: false, reason: "Unavailable prerequisite" } : { admitted: true },
          triggers: [{ event: "autonomy.queue.available", queueMode: "all" }],
          steps: [{ id: "consume", type: "code", run: () => {
            order.push("urgent");
            expect(database.getRun(currentRunId)).toMatchObject({ state: "waiting", attempt: 1, resources: ["task:task-current"] });
            expect(readFileSync(join(workspaces[0], "retained.txt"), "utf8")).toBe("preserved progress\n");
            // Repeated ordinary dispatch cannot duplicate the handoff admission.
            const contract = listBuilderTaskDispatches(root)[0];
            pbus.emit("autonomy.queue.available", { ...contract, dependsOn: [...contract.dependsOn] });
            return "urgent completed";
          } }],
        }],
      });
      runtime.start();
    };
    start();
    try {
      await runtime.enqueuePendingRun("priority-writer");
      currentRunId = database.listRuns(scopeId).find((run) => run.workflow === "priority-writer")!.id;
      if (scenario !== "live") {
        await expect.poll(() => database.getRun(currentRunId)?.state).toBe("waiting");
        await coordinator.whenIdle();
        const before = database.getRun(currentRunId)!;
        await runtime.stop();
        await coordinator.dispose();
        database.close();
        if (scenario === "blocked") {
          writeFileSync(taskPath, "---\nstatus: blocked\npriority: p1\n---\n# Urgent work\n\n## Blocked on\nkind: operator-capture\npath: evidence/operator-run.txt\ndescription: Await external evidence.\n");
          publish();
        } else if (scenario === "removed") { rmSync(taskPath); publish(); }
        else if (scenario === "completed") {
          mkdirSync(join(root, "data/tasks/archive"));
          rmSync(taskPath);
          writeFileSync(join(root, "data/tasks/archive/task-urgent.md"), "---\nstatus: done\n---\n# Urgent work\n\nCompleted.\n");
          publish();
        }
        database = RunStateDatabase.openExisting(stateDir);
        epoch = database.beginDaemonSession(now()).epoch;
        expect(database.getRun(currentRunId)).toMatchObject({ state: "waiting", sandbox: before.sandbox, wait: before.wait, resources: before.resources });
        start();
      }
      await expect.poll(() => {
        const run = database.getRun(currentRunId);
        return JSON.stringify({ state: run?.state, error: run?.lastError, order, decisions });
      }, { timeout: 15_000 }).toContain('"state":"succeeded"');
      await coordinator.whenIdle();
      const handedOff = scenario === "live" || scenario === "restart";
      expect(order).toEqual(handedOff ? ["current", "urgent", "current"] : ["current", "current"]);
      expect(sessions).toEqual([undefined, "preserved-session"]);
      expect(workspaces[1]).toBe(workspaces[0]);
      expect(decisions).toBe(1);
      expect(validations).toBeGreaterThan(0);
      expect(database.listRuns(scopeId).filter((run) => run.workflow === "supply-consumer")).toHaveLength(handedOff ? 1 : 0);
      expect(database.getRun(currentRunId)).toMatchObject({ state: "succeeded", attempt: 2, resources: [] });
      expect(readFileSync(join(root, "retained.txt"), "utf8")).toBe("preserved progress\n");
      process.stdout.write(`Priority handoff ${scenario}: ${order.join(" -> ")}; same session, workspace and run; one judgment.\n`);
    } finally {
      coordinator!.pauseGlobalAdmission();
      await runtime!.stop();
      await coordinator!.dispose();
      database.close();
      bus.clear();
    }
  }, 25_000,
);
