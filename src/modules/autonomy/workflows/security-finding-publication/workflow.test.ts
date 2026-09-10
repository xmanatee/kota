import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { createSecurityFindingTasksInWorker } from "../security-review/blocking-operations.js";
import { securityFindingPublicationRequested } from "../security-review/events.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_RESOURCE, SECURITY_REVIEW_STATE_KEY } from "../security-review/review-state.js";
import { SecurityReviewProjectFixture } from "../security-review/workflow-test-fixture.js";
import workflow from "./workflow.js";

describe("security family publication admission", () => {
  let fixture: SecurityReviewProjectFixture;
  beforeEach(() => { fixture = new SecurityReviewProjectFixture(); });
  afterEach(() => fixture.cleanup());

  it("rechecks legacy batch eligibility after each task mutation", async () => {
    const scopeRoot = fixture.workspaceRoot;
    const taskId = "task-legacy-batch";
    fixture.writeLegacySecurityFindingTask({ id: taskId, state: "open", runId: "historical", claim: "Original repair", findingId: "historical-finding" });
    fixture.commitProjectState();
    const finding = { ...fixture.confirmedFindingForClaim("First revision"), existingTaskId: taskId };
    const first = { runId: "first-review", finding };
    const unresolved = { runId: "second-review", finding: { ...finding, id: "second", evidenceIdentity: "second-revision", claim: "Unresolved second revision" } };
    const validated = { runId: "third-review", finding: { ...finding, id: "third", evidenceIdentity: "third-revision", claim: "Validated third revision",
      evidenceLineage: { kind: "new-variant" as const, reference: "historical-finding", rationale: "Distinct exploit verified against the retained repair" },
    } };
    const replay = { runId: "replay-review", finding };
    const state = createTestTransactionalRunState(join(scopeRoot, ".kota/state"));
    state.compareAndSet(SECURITY_REVIEW_STATE_KEY, state.read(SECURITY_REVIEW_STATE_KEY).revision, {
      ...decodeSecurityReviewState(null), pending: [first, unresolved, validated, replay],
    });
    const result = await new WorkflowScenarioDriver({
      ...workflow,
      steps: [...workflow.steps, {
        id: "observe-publication", type: "code", run: async (ctx) => ({
          pending: decodeSecurityReviewState(ctx.state.read(SECURITY_REVIEW_STATE_KEY).value).pending,
          body: readFileSync(join(ctx.workspaceRoot, `data/tasks/${taskId}.md`), "utf8"),
        }),
      }],
    }, {
      workspaceRoot: scopeRoot, ports: { state, runCommand: runGitEvidenceCommand },
      trigger: { event: securityFindingPublicationRequested.name, payload: { taskId } },
    }).run();
    expect(result.steps["publish-findings"].status, result.steps["publish-findings"].error).toBe("success");
    expect(result.steps["publish-findings"].output).toMatchObject({
      results: [
        { updatedTaskIds: [taskId] },
        { updatedTaskIds: [taskId] },
        { unchangedFindingIds: [finding.id] },
      ],
      parkedFindings: [{ runId: unresolved.runId, findingId: "second", reason: expect.stringContaining("requires revalidated evidence lineage") }],
    });
    // The task writes exist before integration; canonical state must retain
    // every entry until publication succeeds.
    expect(result.steps["observe-publication"].output).toEqual({
      pending: [first, unresolved, validated, replay], body: expect.stringContaining("Original repair"),
    });
    expect(result.steps["observe-publication"].output).toMatchObject({
      body: expect.stringContaining("Validated third revision"),
    });
    expect(result.steps["observe-publication"].output).toMatchObject({
      body: expect.not.stringContaining("Unresolved second revision"),
    });
    expect(result.status, result.error).toBe("success");
    expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual([unresolved]);
    const body = readFileSync(join(scopeRoot, `data/tasks/${taskId}.md`), "utf8");
    expect(body).toContain("Original repair");
    expect(body).toContain("Validated third revision");
    expect(body).not.toContain("Unresolved second revision");
    expect(body.match(/^evidence identity: task-write-v1$/gm)).toHaveLength(1);
  });

  it("reconciles published evidence past an unresolved family and rejects the unresolved target", async () => {
    const scopeRoot = fixture.workspaceRoot;
    const finding = fixture.confirmedFindingForClaim("Already published independent evidence");
    const materialized = createSecurityFindingTasksInWorker({ workspaceRoot: scopeRoot, runId: "original", findings: [finding] });
    const taskId = materialized.createdTaskIds[0]!;
    fixture.writeLegacySecurityFindingTask({ id: "task-superseded", state: "done", runId: "historical", claim: "Superseded repair", supersededBy: "task-canonical" });
    fixture.commitProjectState();
    const state = createTestTransactionalRunState(join(scopeRoot, ".kota/state"));
    const stale = { runId: "older-review", finding: { ...finding, id: "stale", existingTaskId: "task-superseded" } };
    const current = { runId: "repeated-review", finding };
    state.compareAndSet(SECURITY_REVIEW_STATE_KEY, state.read(SECURITY_REVIEW_STATE_KEY).revision, {
      ...decodeSecurityReviewState(null), pending: [stale, current],
    });
    const taskPath = join(scopeRoot, `data/tasks/${taskId}.md`);
    const oldPath = join(scopeRoot, "data/tasks/archive/task-superseded.md");
    const taskBefore = readFileSync(taskPath, "utf8");
    const oldBefore = readFileSync(oldPath, "utf8");
    const run = (target: string) => new WorkflowScenarioDriver(workflow, {
      workspaceRoot: scopeRoot, ports: { state, runCommand: runGitEvidenceCommand },
      trigger: { event: securityFindingPublicationRequested.name, payload: { taskId: target } },
    }).run();
    const published = await run(taskId);
    expect(published.status, published.error).toBe("success");
    expect(published.steps["publish-findings"].output).toMatchObject({ taskId, parkedFindings: [
      { runId: stale.runId, findingId: "stale", reason: expect.stringContaining("superseded") },
    ] });
    expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual([stale]);
    const rejected = await run("task-superseded");
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toBe("integration-invariant-failed");
    expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual([stale]);
    expect(readFileSync(taskPath, "utf8")).toBe(taskBefore);
    expect(readFileSync(oldPath, "utf8")).toBe(oldBefore);
  });

  it("parks publication behind queued and retained task owners without changing their contract", () => {
    const scopeRoot = fixture.workspaceRoot;
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    const stateDir = join(scopeRoot, ".kota/authority");
    const db = new RunStateDatabase(stateDir);
    const taskId = "task-existing-repair";
    fixture.writeLegacySecurityFindingTask({ id: taskId, state: "open", runId: "old", claim: "Original admitted repair" });
    const taskPath = join(scopeRoot, `data/tasks/${taskId}.md`);
    const before = readFileSync(taskPath, "utf8");
    const trigger = { event: securityFindingPublicationRequested.name, schemaRef: null, payload: { taskId } };
    const input = { scopeRoot, scopeId, stateDir, runtimeStateDir: stateDir, workflowName: workflow.name, trigger,
      state: createTestTransactionalRunState(join(scopeRoot, ".kota/test-state"), scopeId),
    };
    try {
      db.registerScope({ id: scopeId, rootPath: scopeRoot, createdAt: new Date().toISOString() });
      expect(workflow.resources!(input)).toEqual([SECURITY_REVIEW_RESOURCE, `task:${taskId}`]);
      expect(workflow.triggerAdmission!(input)).toEqual({ admitted: true });
      db.admitRun({ id: "builder-owner", scopeId, workflow: "builder", repository: "write", resources: [`task:${taskId}`], trigger, admittedAt: new Date().toISOString() });
      expect(workflow.triggerAdmission!(input)).toMatchObject({ admitted: false });
      db.requireRunAttention("builder-owner", "retained writer requires recovery", []);
      expect(workflow.triggerAdmission!(input)).toMatchObject({ admitted: false });
      expect(readFileSync(taskPath, "utf8")).toBe(before);
    } finally { db.close(); }
  });

  it("settles valid evidence for a task while keeping its unresolved legacy evidence pending", async () => {
    const scopeRoot = fixture.workspaceRoot;
    const finding = fixture.confirmedFindingForClaim("Published variant");
    const materialized = createSecurityFindingTasksInWorker({ workspaceRoot: scopeRoot, runId: "original", findings: [finding] });
    const taskId = materialized.createdTaskIds[0]!;
    const taskPath = `data/tasks/${taskId}.md`;
    // This historical record has no verifiable revision; the published variant
    // must not either identify it retroactively or be blocked by it.
    fixture.writeProjectFile(taskPath, `${readFileSync(join(scopeRoot, taskPath), "utf8")}\nsecurity evidence: ${"a".repeat(64)}\n`);
    fixture.commitProjectState();
    const before = readFileSync(join(scopeRoot, taskPath), "utf8");
    const stale = { runId: "unresolved-review", finding: { ...finding, existingTaskId: taskId, evidenceIdentity: "unverified-legacy-revision" } };
    const current = { runId: "variant-review", finding };
    const state = createTestTransactionalRunState(join(scopeRoot, ".kota/state"));
    state.compareAndSet(SECURITY_REVIEW_STATE_KEY, state.read(SECURITY_REVIEW_STATE_KEY).revision, {
      ...decodeSecurityReviewState(null), pending: [stale, current],
    });
    const run = () => new WorkflowScenarioDriver(workflow, {
      workspaceRoot: scopeRoot, ports: { state, runCommand: runGitEvidenceCommand },
      trigger: { event: securityFindingPublicationRequested.name, payload: { taskId } },
    }).run();
    const settled = await run();
    expect(settled.status, settled.error).toBe("success");
    expect(settled.steps["publish-findings"].output).toMatchObject({ parkedFindings: [
      { runId: stale.runId, findingId: stale.finding.id, reason: expect.stringContaining("requires revalidated evidence lineage") },
    ] });
    expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual([stale]);
    const rejected = await run();
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toBe("integration-invariant-failed");
    expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual([stale]);
    expect(readFileSync(join(scopeRoot, taskPath), "utf8")).toBe(before);
  });
});
