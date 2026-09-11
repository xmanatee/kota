import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { WORKFLOW_RUN_METADATA_VERSION } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowStepResult } from "#core/workflow/run-types.js";
import {
  EVALUATOR_CALIBRATION_ARTIFACT,
  EVALUATOR_CALIBRATION_STEP_ID,
  type EvaluatorCalibrationArtifact,
} from "#modules/autonomy/evaluator-calibration.js";
import { writeRunArtifact } from "#modules/eval-harness/runner-artifact.js";
import { assessBuilderRecovery, builderRecoveryRevision } from "./recovery.js";
import {
  inspectBuilderTaskTarget,
  listBuilderTaskDispatches,verifyBuilderTaskContractAfterReconcile, } from "./task-contract.js";
import builderWorkflow from "./workflow.js";

const roots: string[] = [];

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "kota-builder-contract-"));
  roots.push(root);
  mkdirSync(join(root, "data", "tasks", "archive"), { recursive: true });
  return root;
}

function writeTask(root: string, state: string, marker = "initial"): void {
  const dir = state === "done" || state === "dropped"
    ? join(root, "data", "tasks", "archive")
    : join(root, "data", "tasks");
  writeFileSync(
    join(dir, "task-target.md"),
    [
      "---",
      `status: ${state}`,
      ...(state === "open" || state === "blocked" ? ["priority: p1"] : []),
      "---",
      "",
      "# Target",
      "",
      marker,
      "",
    ].join("\n"),
  );
}

function publish(root: string): void {
  const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "--quiet"]);
  git(["add", "data"]);
  git(["-c", "user.name=KOTA Test", "-c", "user.email=kota@example.test", "-c", "core.hooksPath=/dev/null", "commit", "--no-gpg-sign", "-m", "Task intent"]);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("targeted builder contract", () => {
  it("binds each run to its task resource and shared write sandbox", () => {
    const trigger = {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {
        taskId: "task-target",
        taskPath: "data/tasks/task-target.md",
        taskState: "open",
        taskDigest: "a".repeat(64),
        idempotencyKey: `builder:task-target:${"a".repeat(64)}`,
      },
    };
    expect(builderWorkflow.repository).toBe("write");
    expect(builderWorkflow.resources?.({
      scopeRoot: "/repo",
      stateDir: "/repo/.kota",
      workflowName: "builder",
      trigger,
    })).toEqual(["task:task-target"]);
    expect(builderWorkflow.triggers).toEqual([
      { event: "autonomy.queue.available", queueMode: "all" },
    ]);
  });

  it("ignores retained worker notes but rejects changes to the admitted source", async () => {
    const root = project();
    const workspace = project();
    writeTask(root, "open");
    writeTask(workspace, "open", "retained implementation notes");
    publish(root);
    const payload = listBuilderTaskDispatches(root)[0]!;
    const preflight = builderWorkflow.steps.find((step) => step.id === "inspect-target-task");
    if (!preflight || preflight.type !== "code") throw new Error("missing preflight");
    const agentDir = join(workspace, "agent");
    expect(await preflight.run({
      runtimeResources: { agentRunDir: agentDir },
      workflow: { runId: "retained" },
      state: { read: () => ({ revision: 0, value: null }) },
      scopeRoot: root,
      workspaceRoot: workspace,
      trigger: { payload },
      runBlocking: runWorkflowBlockingOperation,
    } as never)).toMatchObject({ actionable: true });
    writeTask(root, "open", "changed");
    expect(inspectBuilderTaskTarget({ workspaceRoot: root, payload })).toMatchObject({ actionable: true });
    publish(root);

    expect(inspectBuilderTaskTarget({ workspaceRoot: root, payload })).toMatchObject({
      actionable: false,
      taskId: "task-target",
      reason: "task contract changed after dispatch",
    });
  });

  it("retains unchanged failures and reconciles a changed canonical contract without changing task identity", async () => {
    const root = project();
    writeTask(root, "open");
    publish(root);
    const payload = listBuilderTaskDispatches(root)[0]!;
    const store = new RunStateDatabase(join(root, ".kota"));
    store.registerScope({ id: "scope", rootPath: root, createdAt: new Date().toISOString() });
    const input = {
      scopeRoot: root, stateDir: join(root, ".kota"), scopeId: "scope", workflowName: "builder", runId: "retained",
      runtimeStateDir: join(root, ".kota"),
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload },
      state: { read: <T,>(key: string) => store.readScopeStateValue<T>("scope", key) },
    };
    try {
      expect((await assessBuilderRecovery(input))).toMatchObject({ resume: false });
      writeTask(root, "open", "Clarified acceptance; preserve the original goal");
      publish(root);
      const revised = (await assessBuilderRecovery(input));
      expect(revised).toMatchObject({ resume: true, trigger: { payload: { taskId: payload.taskId } } });
      if (!revised.resume) throw new Error("expected changed contract recovery");
      expect(revised.trigger.payload.taskDigest).not.toBe(payload.taskDigest);
      store.compareAndSetScopeStateValue({
        scopeId: "scope", key: "workflow:recovery:retained", expectedRevision: 0,
        value: { revision: revised.revision }, updatedAt: new Date().toISOString(),
      });
      expect((await assessBuilderRecovery({ ...input, trigger: revised.trigger }))).toMatchObject({ resume: false });
      writeTask(root, "blocked", "## Blocked on\nkind: operator-capture\npath: .kota/runs\ndescription: External result required");
      expect((await assessBuilderRecovery(input))).toMatchObject({ resume: false });
    } finally { store.close(); }
  });

  it("recovers on task-linked execution and capability exports while restraining observation churn", async () => {
    const root = project();
    writeTask(root, "open", "Requires Linux boundary results; existing cohort .kota/eval-runs/linux-boundary");
    publish(root);
    const payload = listBuilderTaskDispatches(root)[0]!;
    const store = new RunStateDatabase(join(root, ".kota"));
    store.registerScope({ id: "scope", rootPath: root, createdAt: new Date().toISOString() });
    const input = {
      scopeRoot: root, stateDir: join(root, ".kota"), scopeId: "scope", workflowName: "builder", runId: "retained",
      runtimeStateDir: join(root, ".kota"),
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload },
      state: { read: <T,>(key: string) => store.readScopeStateValue<T>("scope", key) },
    };
    const acceptRevision = (revision: string) => {
      const key = "workflow:recovery:retained";
      store.compareAndSetScopeStateValue({
        scopeId: "scope", key, expectedRevision: store.readScopeStateValue("scope", key).revision,
        value: { revision }, updatedAt: new Date().toISOString(),
      });
    };
    const exportResult = (path: string, content: object) => {
      const directory = join(root, ".kota", path);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "result.json"), JSON.stringify(content));
    };
    try {
      acceptRevision((await builderRecoveryRevision(input)));
      exportResult("runs/unrelated", { taskId: "task-other", outcome: "pass" });
      exportResult("runs/retained", { taskId: payload.taskId, outcome: "failed attempt" });
      expect((await assessBuilderRecovery(input))).toMatchObject({ resume: false });

      for (const reportId of ["daily-one", "daily-two"]) {
        exportResult(`runs/${reportId}`, { taskId: payload.taskId, summary: "Still blocked", generatedAt: reportId });
        // A report's task mention must not link unrelated execution in its cohort.
        const other = join(root, ".kota", "runs", reportId, "other-result.json");
        writeFileSync(other, JSON.stringify({ taskId: "task-other", source: "linux-child", outcome: "pass" }));
        expect(await assessBuilderRecovery(input)).toMatchObject({ resume: false });
      }

      const boundary = { taskId: payload.taskId, source: "linux-child", results: { database: "denied", lateJournal: "denied", repoRead: "allowed", artifactRead: "allowed" } };
      exportResult("eval-runs/linux-boundary", boundary);
      const execution = (await assessBuilderRecovery(input));
      expect(execution).toMatchObject({ resume: true, trigger: input.trigger });
      if (!execution.resume) throw new Error("expected new execution evidence recovery");
      acceptRevision(execution.revision);
      exportResult("eval-runs/linux-boundary", { capturedAt: "2026-09-10T04:00:00Z", ...boundary });
      expect((await assessBuilderRecovery(input))).toMatchObject({ resume: false });

      exportResult("runs/capability", { taskId: payload.taskId, capability: "contained-linux-child", status: "available" });
      const capability = (await assessBuilderRecovery(input));
      expect(capability).toMatchObject({ resume: true, trigger: input.trigger });
      if (!capability.resume) throw new Error("expected new capability observation recovery");
      acceptRevision(capability.revision);
      for (const copy of ["copy-one", "copy-two"]) {
        exportResult(`eval-runs/${copy}`, { ...boundary, exportedAt: copy });
        exportResult(`runs/${copy}`, { taskId: payload.taskId, capability: "contained-linux-child", status: "available", exportedAt: copy, generatedAt: copy });
        expect(await assessBuilderRecovery(input)).toMatchObject({ resume: false });
      }
      exportResult("runs/capability", { taskId: payload.taskId, capability: "contained-linux-child", status: "unavailable" });
      expect(await assessBuilderRecovery(input)).toMatchObject({ resume: true });

      const failed = { taskId: payload.taskId, execution: "os-contained-command", exitCode: 1,
        source: { revision: "unchanged-source", isolation: "linux-pid-namespace" },
        predicateResults: [{ name: "child-denial", passed: false }],
      };
      exportResult("runs/failed-probe", { ...failed, startedAt: "2026-09-10T05:00:00Z" });
      acceptRevision(await builderRecoveryRevision(input));
      exportResult("runs/failed-probe", { ...failed, startedAt: "2026-09-10T06:00:00Z",
        finishedAt: "2026-09-10T06:01:00Z", durationMs: 60000, runId: "new-attempt",
      });
      expect(await assessBuilderRecovery(input)).toMatchObject({ resume: false });
      exportResult("runs/failed-probe", { ...failed, exitCode: 0,
        predicateResults: [{ name: "child-denial", passed: true }],
      });
      expect(await assessBuilderRecovery(input)).toMatchObject({ resume: true });
    } finally { store.close(); }
  });

  it("ignores relocated eval attempts but retains source, isolation and result changes", async () => {
    const root = project();
    writeTask(root, "open", "Requires evidence from .kota/eval-runs/boundary");
    publish(root);
    const store = new RunStateDatabase(join(root, ".kota"));
    store.registerScope({ id: "scope", rootPath: root, createdAt: new Date().toISOString() });
    const input = {
      scopeRoot: root, stateDir: join(root, ".kota"), scopeId: "scope", workflowName: "builder", runId: "retained",
      runtimeStateDir: join(root, ".kota"),
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: listBuilderTaskDispatches(root)[0]! },
      state: { read: <T,>(key: string) => store.readScopeStateValue<T>("scope", key) },
    };
    const resourceProfile = {
      cpuAllocationCores: 1, cpuKillThresholdCores: 2,
      memoryAllocationMB: 512, memoryKillThresholdMB: 1024, hostClass: "linux",
    };
    const executionProfile = {
      status: "verified", backendKind: "container", requestedProfile: resourceProfile,
      observedOrEnforcedProfile: resourceProfile, verification: "enforced", gateEligible: true,
      eligibilityReason: "verified-profile", diagnostics: [],
      networkPolicy: { kind: "offline", enforcementMode: "docker-network-none", allowedProviderEndpoints: [], gateEligible: true },
    } as const;
    const artifactDir = join(root, ".kota/eval-runs/boundary");
    const payload: Parameters<typeof writeRunArtifact>[1] = {
      run: {
        fixtureId: "boundary", runIndex: 0, repeatCount: 1, executionMode: "live", outcome: "fail",
        resourceProfile, executionProfile: { ...executionProfile, diagnostics: [] },
        objectiveMetrics: [], objectiveMetricErrors: [],
        timing: { startedAt: "2026-09-10T05:00:00Z", durationMs: 100, budgetMs: 1000 },
        runArtifactPath: join(artifactDir, "attempt-one"),
        executionEvidence: {
          artifactDir: join(artifactDir, "attempt-one/execution-evidence"), usage: UNKNOWN_AGENT_USAGE,
          turns: 1, toolCalls: 0, toolResults: 0, approvalRequests: 0, trajectoryDiagnostics: null,
          changedFiles: [], issues: [], traceAvailable: true,
        },
      },
      fixtureId: "boundary", workflowName: "builder", workingDir: "/tmp/fixture-one",
      executionOutcome: { kind: "completed", durationMs: 100, runArtifactPath: "/tmp/fixture-one/.kota/runs/child" },
      executionProfile: { ...executionProfile, diagnostics: [] },
      predicates: [{ kind: "file-exists", path: "denial-proof.json" }], preRunExpectationResults: [],
      predicateResults: [{ predicate: { kind: "file-exists", path: "denial-proof.json" }, passed: false, detail: "missing proof" }],
      objectiveMetrics: [], objectiveMetricErrors: [],
    };
    try {
      writeRunArtifact(artifactDir, payload);
      const baseline = await builderRecoveryRevision(input);
      store.compareAndSetScopeStateValue({
        scopeId: "scope", key: "workflow:recovery:retained", expectedRevision: 0,
        value: { revision: baseline }, updatedAt: new Date().toISOString(),
      });
      expect(await assessBuilderRecovery(input)).toMatchObject({ resume: false });
      payload.run.runArtifactPath = join(artifactDir, "attempt-two");
      payload.workingDir = "/tmp/fixture-two";
      payload.executionOutcome.runArtifactPath = "/tmp/fixture-two/.kota/runs/child";
      payload.run.executionEvidence!.artifactDir = join(artifactDir, "attempt-two/execution-evidence");
      writeRunArtifact(artifactDir, payload);
      expect(await assessBuilderRecovery(input)).toMatchObject({ resume: false });

      // Each substantive change is compared with the same failed baseline.
      for (const change of [
        { ...payload, fixtureId: "revised-boundary" },
        { ...payload, run: { ...payload.run, executionProfile: { ...payload.run.executionProfile, verification: "observed" as const } } },
        { ...payload, predicateResults: [{ ...payload.predicateResults[0]!, passed: true }] },
        { ...payload, predicates: [{ kind: "file-exists" as const, path: "other-proof.json" }] },
      ]) {
        writeRunArtifact(artifactDir, change);
        expect(await assessBuilderRecovery(input)).toMatchObject({ resume: true });
      }
      writeRunArtifact(artifactDir, payload);
      expect(await assessBuilderRecovery(input)).toMatchObject({ resume: false });
    } finally { store.close(); }
  });

  it("keeps the event loop responsive while recovery reads unrelated history", async () => {
    const root = project();
    writeTask(root, "open");
    publish(root);
    const dir = join(root, ".kota/runs/unrelated");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, `${i}.json`), JSON.stringify({ taskId: "task-other", source: "fixture", outcome: "pass" }));
    }
    const input = {
      scopeRoot: root, stateDir: join(root, ".kota"), scopeId: "scope", workflowName: "builder", runId: "retained",
      runtimeStateDir: join(root, ".kota"),
      trigger: { event: "autonomy.queue.available", schemaRef: null, payload: listBuilderTaskDispatches(root)[0]! },
      state: { read: () => ({ revision: 0, value: null }) },
    };
    const started = performance.now();
    const heartbeat = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - started), 20));
    const assessment = assessBuilderRecovery(input);
    // Measure from before invocation: a synchronous scan would delay this timer
    // for the whole history even if the resolver returned a Promise afterwards.
    const delay = await heartbeat;
    expect(await assessment).toMatchObject({ resume: false });
    expect(delay).toBeLessThan(500);
  }, 20_000);

  it("rechecks the admitted source contract after reconciliation", () => {
    const root = project();
    const workspace = project();
    writeTask(root, "open");
    writeTask(workspace, "open", "retained notes");
    publish(root);
    const payload = listBuilderTaskDispatches(root)[0]!;
    const invariant = verifyBuilderTaskContractAfterReconcile;
    const input = {
      workspaceRoot: workspace,
      repoRoot: root,
      stateDir: join(root, ".kota"),
      runId: "builder-contract-run",
      readState: () => ({ revision: 0, value: null }),
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload,
      },
      head: "reconciled-head",
      baseHead: "base-head",
      canonicalHead: "canonical-head",
      signal: new AbortController().signal,
    };

    const runDir = join(input.stateDir, "runs", input.runId);
    mkdirSync(runDir, { recursive: true });
    const metadata = {
      metadataVersion: WORKFLOW_RUN_METADATA_VERSION,
      id: input.runId,
      workflow: "builder",
      definitionPath: "workflow.ts",
      trigger: input.trigger,
      startedAt: "2026-09-07T00:00:00.000Z",
      status: "success",
      runDir,
      steps: [{
        id: "build", type: "agent", status: "skipped",
        startedAt: "2026-09-07T00:00:00.000Z",
        completedAt: "2026-09-07T00:00:01.000Z", durationMs: 1000,
        skipReason: { kind: "when-predicate" },
      }] as WorkflowStepResult[],
    };
    const persist = () => writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata));
    persist();
    expect(invariant(input)).toMatchObject({ satisfied: false, reason: expect.stringContaining("successful build") });
    const successfulBuild = {
      id: "build", type: "agent", status: "success",
      startedAt: "2026-09-07T00:00:00.000Z",
      completedAt: "2026-09-07T00:00:01.000Z", durationMs: 1000,
      usage: {
        tokens: { state: "complete", inputTokens: 100, outputTokens: 20 },
        cost: { state: "complete", usd: 0.01 },
      },
    } satisfies WorkflowStepResult;
    metadata.steps = [successfulBuild];
    persist();
    expect(invariant(input)).toMatchObject({ satisfied: false, reason: expect.stringContaining("must move targeted task") });
    writeTask(workspace, "blocked", "## Blocked on\nkind: operator-capture\npath: evidence\ndescription: Scoped execution proof unavailable");
    publish(workspace);
    expect(invariant(input)).toEqual({ satisfied: true });
    metadata.steps[0] = { ...successfulBuild, status: "failed" };
    persist();
    expect(invariant(input)).toMatchObject({ satisfied: false, reason: expect.stringContaining("successful build") });
    metadata.steps[0] = successfulBuild;
    persist();
    rmSync(join(workspace, "data/tasks/task-target.md"));
    writeTask(workspace, "done");
    publish(workspace);
    expect(invariant(input)).toEqual({ satisfied: true });
    writeTask(root, "open", "changed after admission");
    expect(invariant(input)).toEqual({ satisfied: true });
    publish(root);
    expect(invariant(input)).toMatchObject({
      satisfied: false,
      reason: expect.stringMatching(/no longer matches its admitted source contract/i),
    });
  });

  it("runs build only after target and harness preflights succeed", () => {
    const build = builderWorkflow.steps.find((step) => step.id === "build");
    if (!build || build.type !== "agent" || !build.when) throw new Error("missing build step");
    const target = {
      actionable: true,
      taskId: "task-target",
      taskPath: "data/tasks/task-target.md",
      taskState: "open",
      taskDigest: "a".repeat(64),
      reason: null,
    };
    const context = {
      stepOutputs: { "inspect-target-task": target },
      stepResults: {
        "inspect-target-task": { id: "inspect-target-task", status: "success" },
        "preflight-builder-harness": {
          id: "preflight-builder-harness",
          status: "success",
        },
      },
    };
    expect(build.when(context as never)).toBe(true);
    expect(
      build.when({
        ...context,
        stepOutputs: {
          "inspect-target-task": { ...target, actionable: false, reason: "stale" },
        },
      } as never),
    ).toBe(false);
  });

  it("writes calibration from the builder critic directory, ignoring stale run-root evidence", async () => {
    const root = project();
    const runDir = join(root, ".kota", "runs", "run-builder");
    const criticVerdictRunDir = join(
      root,
      ".kota",
      "builder-evidence",
      "run-builder",
    );
    mkdirSync(runDir, { recursive: true });
    mkdirSync(criticVerdictRunDir, { recursive: true });
    writeTask(root, "done");
    writeFileSync(
      join(runDir, "critic-review.json"),
      JSON.stringify({
        verdict: "fail",
        critical_issues: ["Stale run-root verdict."],
        warnings: [],
        summary: "This verdict belongs to a different evidence source.",
      }),
    );
    writeFileSync(
      join(criticVerdictRunDir, "critic-review.json"),
      JSON.stringify({
        verdict: "pass",
        critical_issues: [],
        warnings: [],
        summary: "The builder result passed independent review.",
        reviewerPromptHash: "builder-critic-prompt",
      }),
    );

    const calibration = builderWorkflow.steps.find(
      (step) => step.id === EVALUATOR_CALIBRATION_STEP_ID,
    );
    if (!calibration || calibration.type !== "code") {
      throw new Error("missing builder calibration step");
    }
    const taskDigest = "a".repeat(64);
    const result = await calibration.run({
      workspaceRoot: root,
      runtimeResources: { agentRunDir: criticVerdictRunDir },
      workflow: {
        name: "builder",
        runId: "run-builder",
        runDirPath: runDir,
      },
      trigger: {
        payload: {
          taskId: "task-target",
          taskPath: "data/tasks/task-target.md",
          taskState: "open",
          taskDigest,
          idempotencyKey: `builder:task-target:${taskDigest}`,
        },
      },
      stepOutputs: { build: { repairIterations: [] } },
      stepResults: { build: { status: "success" } },
    } as never) as EvaluatorCalibrationArtifact;

    expect(result).toMatchObject({
      verdict: "pass",
      criticPromptHash: "builder-critic-prompt",
    });
    expect(
      JSON.parse(
        readFileSync(join(runDir, EVALUATOR_CALIBRATION_ARTIFACT), "utf8"),
      ),
    ).toMatchObject({
      verdict: "pass",
      criticPromptHash: "builder-critic-prompt",
    });
  });
});
