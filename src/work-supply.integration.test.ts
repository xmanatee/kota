import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { clearCustomTools, deregisterTool, registerTool } from "#core/tools/index.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import dispatcher from "#modules/autonomy/workflows/dispatcher/workflow.js";
import { decodeExplorerState, EXPLORER_STATE_KEY, type ExplorerState } from "#modules/autonomy/workflows/explorer/explorer-state.js";
import type { refreshExplorerSources } from "#modules/autonomy/workflows/explorer/source-evidence.js";
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
    const publication = review.emitted.find((event) => event.event === "autonomy.explorer.publication.requested")!;
    const published = await new WorkflowScenarioDriver(explorerPublication, {
      workspaceRoot: root, trigger: { event: publication.event, payload: publication.payload },
      ports: { state: { stateDir, scopeId } },
    }).run();
    expect(published.status, published.error).toBe("success");
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
});
