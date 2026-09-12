import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import * as workflowCommands from "#core/workflow/workflow-command.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, applyAutonomyIssueObservations, buildAutonomyIssueObservation, emptyAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { createGeneratedWorkQuestionQueue } from "#modules/autonomy/generated-work-owner-question.js";
import { materializeGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { improvementHandoffRequested } from "#modules/autonomy/improvement-handoff.js";
import { PROGRESS_REVIEW_ARTIFACT } from "#modules/autonomy/workflows/progress-reviewer/progress-review.js";
import { decodeProgressReviewConsumptionState, emptyProgressReviewConsumptionState } from "#modules/autonomy/workflows/progress-reviewer/semantic-input-state.js";
import { publishProgressReview } from "#modules/autonomy/workflows/progress-reviewer/semantic-publication.js";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { decodeGardenerDecision } from "./decision.js";
import { architectureReviewRequested } from "./events.js";
import { GARDENER_STATE_KEY } from "./gardener-state.js";
import { stageGardenerTask } from "./gardener-task.js";
import { ARCHITECTURE_GARDENER_RUN_ARTIFACT } from "./proposal-identity.js";
import type { ArchitectureGardenerRunState, ArchitectureObservation } from "./types.js";
import architectureGardenerWorkflow, { verifyGardenerSettlementAfterReconcile } from "./workflow.js";

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ownershipDecision() {
  return decodeGardenerDecision({
    action: "propose", rationale: "Foo retains an obsolete registration used by a maintained caller.",
    evidenceRefs: ["src/modules/foo/index.ts"], existingTaskId: null,
    revisit: { reason: "Review changed registration ownership and delivered caller evidence.", deliveryIssueKeys: [] },
    proposal: {
      priority: "p1", mechanismKey: "foo-owner", title: "Retire duplicate foo registration",
      problem: "Foo has two registration owners.", expectedOutcome: "One registration owner.",
      consumers: ["src/modules/foo/index.ts"], alternatives: ["Keep separate registration if callers need it."],
      migrationAndRetirement: "Migrate callers and remove duplicate registration.",
      preservationEvidenceNeeded: "Exercise registration through the maintained caller.",
      simplificationEvidenceNeeded: "Inspect the remaining owner and migrated caller.", abstraction: null,
    },
  });
}

describe("Architecture Gardener Workflow", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = mkdtempSync(join(tmpdir(), "kota-gardener-wf-test-"));
    mkdirSync(join(testWorkspace, "src", "core"), { recursive: true });
    mkdirSync(join(testWorkspace, "src", "modules", "foo"), { recursive: true });
    mkdirSync(join(testWorkspace, "data", "tasks"), { recursive: true });
    mkdirSync(join(testWorkspace, ".kota"), { recursive: true });

    writeFileSync(
      join(testWorkspace, "src", "core", "clean.ts"),
      "export const coreUtil = () => true;\n",
      "utf-8",
    );
    writeFileSync(
      join(testWorkspace, "src", "modules", "foo", "index.ts"),
      "export default { name: \"foo\", dependencies: [] };\n",
      "utf-8",
    );
    writeFileSync(
      join(testWorkspace, "package.json"),
      `${JSON.stringify({ name: "test-pkg", version: "1.0.0", scripts: {} }, null, 2)}\n`,
      "utf-8",
    );
    writeFileSync(join(testWorkspace, ".gitignore"), ".kota/\n", "utf-8");

    runGit(testWorkspace, ["init", "--quiet"]);
    runGit(testWorkspace, ["add", "."]);
    runGit(testWorkspace, [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "init",
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testWorkspace, { recursive: true, force: true });
  });

  it.each([
    { followUp: "automatic", evidence: "available" },
    { followUp: "module:foo", evidence: "available" },
    { followUp: "automatic", evidence: "missing" },
    { followUp: "module:foo", evidence: "missing" },
    { followUp: "src/modules/foo/index.ts", evidence: "missing" },
    { followUp: "automatic", evidence: "mismatched" },
  ])("recovers pre-identity handoff ownership on $followUp terminal follow-up with $evidence history", async ({ followUp, evidence }) => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "upgrade-state"));
    const decision = ownershipDecision();
    const topicKey = "improvement:foo-registration";
    const staged = stageGardenerTask({ heldTaskIds: [], workspaceRoot: testWorkspace, runId: "old-gardener-run", topicKey, decision });
    const original = findGeneratedWorkTask(testWorkspace, topicKey)!.task;
    const oldRunDir = join(testWorkspace, ".kota", "runs", "old-gardener-run");
    mkdirSync(oldRunDir, { recursive: true });
    // Score-based history shares the artifact location but predates proposal
    // identities. Encounter it before either attributable investigation record.
    const scoreRunDir = join(testWorkspace, ".kota", "runs", "earlier-score-run");
    mkdirSync(scoreRunDir, { recursive: true });
    writeFileSync(join(scoreRunDir, ARCHITECTURE_GARDENER_RUN_ARTIFACT), JSON.stringify({
      schemaVersion: 1, runId: "earlier-score-run", executedAt: "2026-09-01T00:00:00.000Z",
      observations: [], evaluations: [], hypotheses: [], paretoEvaluations: [], staged: null,
    }));
    // The shipped state had only task links; its ordinary run artifact retained
    // the handoff key and investigated mechanism (without the new revisit data).
    const { revisit: _revisit, ...oldDecision } = decision;
    writeFileSync(join(oldRunDir, ARCHITECTURE_GARDENER_RUN_ARTIFACT), JSON.stringify({
      schemaVersion: 2, runId: "old-gardener-run", admission: { targetScope: "src/modules/foo" },
      handoff: { topicKey, targetScope: "module:foo" }, decision: oldDecision,
      staged: { taskId: staged.taskId, proposalKey: evidence === "mismatched" ? "improvement:wrong-topic" : staged.proposalKey, touchedTaskQueue: true },
    }));
    if (evidence === "missing") rmSync(oldRunDir, { recursive: true });
    const secondTopicKey = "improvement:foo-cleanup";
    const secondDecision = decodeGardenerDecision({ ...decision, proposal: { ...decision.proposal!,
      mechanismKey: "foo-cleanup", title: "Unify foo cleanup ownership", problem: "Foo has two cleanup owners.",
      expectedOutcome: "One cleanup owner.",
    } });
    const secondStaged = stageGardenerTask({ heldTaskIds: [], workspaceRoot: testWorkspace, runId: "later-gardener-run",
      topicKey: secondTopicKey, decision: secondDecision });
    const secondTask = findGeneratedWorkTask(testWorkspace, secondTopicKey)!.task;
    const laterRunDir = join(testWorkspace, ".kota", "runs", "later-gardener-run");
    mkdirSync(laterRunDir, { recursive: true });
    writeFileSync(join(laterRunDir, ARCHITECTURE_GARDENER_RUN_ARTIFACT), JSON.stringify({
      schemaVersion: 2,
      admission: { targetScope: "src/modules/foo" }, handoff: { targetScope: "module:foo" },
      decision: secondDecision, staged: secondStaged,
    }));
    // Only the later topic's disposition survives in the legacy scope record.
    state.compareAndSet(GARDENER_STATE_KEY, 0, {
      schemaVersion: 2, updatedAt: new Date().toISOString(), lastRunId: "later-gardener-run",
      reviewedTaskEvidence: [], linkedTaskIds: [original.id, secondTask.id], reviewedCohorts: {},
      dispositions: { "src/modules/foo": { targetScope: "src/modules/foo", disposition: "proposed",
        reason: secondDecision.rationale, decidedAt: new Date().toISOString(), taskId: secondTask.id } },
    } satisfies ArchitectureGardenerRunState);
    moveTaskById(testWorkspace, original.id, "done");
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "complete old intervention"]);
    const trigger = followUp === "automatic"
      ? { event: "workflow.completed", payload: { workflow: "builder", scopeId: state.scopeId } }
      : { event: architectureReviewRequested.name, payload: { targetScope: followUp, scopeId: state.scopeId, reason: "Revisit delivered caller evidence" } };
    const reopened = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } }, trigger,
      stepOutputs: { investigate: { ...decision, proposal: { ...decision.proposal!,
        priority: "p2", expectedOutcome: "One owner including the newly discovered caller." } } },
    }).run();
    expect(findGeneratedWorkTask(testWorkspace, secondTopicKey)!.task).toEqual(secondTask);
    if (evidence !== "available") {
      expect(reopened.status).toBe("failed");
      expect(reopened.error).toContain(evidence === "missing" ? "identity is unavailable" : "does not match linked task");
      expect(listFullRepoTasks(testWorkspace)).toHaveLength(2);
      expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task).toMatchObject({ id: original.id, state: "done" });
      return;
    }
    expect(reopened.status, reopened.error).toBe("success");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(2);
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task).toMatchObject({ id: original.id, state: "open", priority: "p2" });
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task.body).toContain("newly discovered caller");
    rmSync(oldRunDir, { recursive: true });
    const replay = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } }, trigger,
    }).run();
    expect(replay.status, replay.error).toBe("success");
    expect(replay.steps.investigate?.status).toBe("skipped");
    moveTaskById(testWorkspace, original.id, "done");
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "complete revised intervention"]);
    const later = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } }, trigger,
      stepOutputs: { investigate: { ...decision, proposal: { ...decision.proposal!,
        priority: "p3", expectedOutcome: "One owner including the final caller." } } },
    }).run();
    expect(later.status, later.error).toBe("success");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(2);
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task).toMatchObject({ id: original.id, state: "open", priority: "p3" });
  });

  it.each([
    { origin: "module:foo", followUp: "automatic" },
    { origin: "module:foo", followUp: "module:foo" },
    { origin: "repo", followUp: "module:foo" },
    { origin: "src/modules", followUp: "module:foo" },
    { origin: "module:foo", followUp: "src/modules/foo/index.ts" },
    { origin: "src/modules/foo/index.ts", followUp: "module:foo" },
  ])("reopens the original $origin handoff task on $followUp follow-up after restart and another mechanism's review", async ({ origin, followUp }) => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "automatic-topic-state"));
    const decision = ownershipDecision();
    const topicKey = "improvement:foo-registration";
    const trigger = { event: improvementHandoffRequested.name, payload: {
      scopeId: state.scopeId, owner: "architecture-gardener", targetScope: origin, topicKey,
      reason: "Inspect duplicated registration", evidenceRefs: decision.evidenceRefs,
      evidenceFingerprint: "a".repeat(64), requestedBy: "progress-reviewer", idempotencyKey: "first",
    } };
    const assess = (value: typeof decision) => ({ ...value, evidenceAssessment: value.evidenceRefs.map((ref) => ({
      ref, available: true, assessment: "Inspected maintained registration callers.",
    })) });
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state }, trigger, stepOutputs: { investigate: assess(decision) },
    }).run();
    expect(first.status, first.error).toBe("success");
    const task = findGeneratedWorkTask(testWorkspace, topicKey)!.task;
    const revised = decodeGardenerDecision({ ...decision, proposal: { ...decision.proposal!,
      priority: "p2", expectedOutcome: "One owner including the newly discovered caller.",
    } });
    const deferred = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { ...trigger, payload: { ...trigger.payload, evidenceFingerprint: "b".repeat(64), idempotencyKey: "revised" } },
      stepOutputs: { investigate: assess(revised) },
    }).run();
    expect(deferred.status, deferred.error).toBe("success");
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task).toEqual(task);
    expect(JSON.parse(readFileSync(join(deferred.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8")).staged)
      .toMatchObject({ disposition: "deferred", taskId: task.id, touchedTaskQueue: false });

    const secondTopicKey = "improvement:foo-cleanup";
    const second = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { ...trigger, payload: { ...trigger.payload, topicKey: secondTopicKey,
        evidenceFingerprint: "c".repeat(64), idempotencyKey: "second-mechanism" } },
      stepOutputs: { investigate: assess(decodeGardenerDecision({ ...decision, proposal: { ...decision.proposal!,
        mechanismKey: "foo-cleanup", title: "Unify foo cleanup ownership", problem: "Foo has two cleanup owners.",
        expectedOutcome: "One cleanup owner.",
      } })) },
    }).run();
    expect(second.status, second.error).toBe("success");
    const secondTask = findGeneratedWorkTask(testWorkspace, secondTopicKey)!.task;
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(2);

    const noAction = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo", reason: "Check current caller evidence" } },
      stepOutputs: { investigate: { ...decision, action: "no-action", proposal: null,
        rationale: "Wait for the active task's delivered caller evidence." } },
    }).run();
    expect(noAction.status, noAction.error).toBe("success");
    moveTaskById(testWorkspace, task.id, "done");
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "complete intervention"]);
    const followUpTrigger = followUp === "automatic"
      ? { event: "workflow.completed", payload: { workflow: "builder", scopeId: state.scopeId } }
      : { event: architectureReviewRequested.name, payload: { targetScope: followUp, scopeId: state.scopeId, reason: "New caller evidence warrants revisiting registration ownership" } };
    const reopened = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
      trigger: followUpTrigger, stepOutputs: { investigate: revised },
    }).run();
    expect(reopened.status, reopened.error).toBe("success");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(2);
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task).toMatchObject({ id: task.id, state: "open", priority: "p2" });
    expect(findGeneratedWorkTask(testWorkspace, secondTopicKey)!.task).toEqual(secondTask);
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task.body).toContain("newly discovered caller");
    const replay = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state }, trigger: followUpTrigger,
    }).run();
    expect(replay.status, replay.error).toBe("success");
    expect(replay.steps.investigate?.status).toBe("skipped");
  });

  it("keeps original handoff scope after a repository follow-up and separates sibling ownership", async () => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "disjoint-topic-state"));
    const decision = ownershipDecision();
    const topicKey = "improvement:foo-other-registration";
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: improvementHandoffRequested.name, payload: {
        scopeId: state.scopeId, owner: "architecture-gardener", targetScope: "module:foo-other", topicKey,
        reason: "Inspect the other module's registration", evidenceRefs: decision.evidenceRefs,
        evidenceFingerprint: "a".repeat(64), requestedBy: "progress-reviewer", idempotencyKey: "first",
      } },
      stepOutputs: { investigate: { ...decision, evidenceAssessment: decision.evidenceRefs.map((ref) => ({
        ref, available: true, assessment: "Inspected the other registration owner's caller.",
      })) } },
    }).run();
    expect(first.status, first.error).toBe("success");
    const original = findGeneratedWorkTask(testWorkspace, topicKey)!.task;
    moveTaskById(testWorkspace, original.id, "done");
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "complete scoped intervention"]);
    const automatic = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: "workflow.completed", payload: { workflow: "builder", scopeId: state.scopeId } },
      stepOutputs: { investigate: decision },
    }).run();
    expect(automatic.status, automatic.error).toBe("success");
    const reopened = findGeneratedWorkTask(testWorkspace, topicKey)!.task;
    expect(reopened).toMatchObject({ id: original.id, state: "open" });
    const followUp = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo", reason: "Review foo's independent registration" } },
      stepOutputs: { investigate: decision },
    }).run();
    expect(followUp.status, followUp.error).toBe("success");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(2);
    expect(findGeneratedWorkTask(testWorkspace, topicKey)!.task).toEqual(reopened);
    expect(findGeneratedWorkTask(testWorkspace, "architecture-gardener:foo-owner")!.task.id).not.toBe(original.id);
    const artifact = JSON.parse(readFileSync(join(followUp.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.linkedTasks).toEqual([]);
  });

  it.each(["linked", "cited"])("rejects stale no-action judgments using %s terminal task evidence", async (source) => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "no-action-state"));
    const decision = ownershipDecision();
    let taskId: string;
    if (source === "linked") {
      const proposal = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
        workspaceRoot: testWorkspace, ports: { state },
        trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo" } },
        stepOutputs: { investigate: decision },
      }).run();
      expect(proposal.status, proposal.error).toBe("success");
      taskId = listFullRepoTasks(testWorkspace)[0]!.id;
    } else {
      taskId = stageGardenerTask({ heldTaskIds: [], workspaceRoot: testWorkspace, runId: "seed", decision }).taskId!;
    }
    moveTaskById(testWorkspace, taskId, "done");
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "publish terminal evidence"]);
    const taskPath = join("data", "tasks", "archive", `${taskId}.md`);
    const canonicalSnapshot = join(testWorkspace, ".kota", "canonical-no-action");
    cpSync(join(testWorkspace, "data"), join(canonicalSnapshot, "data"), { recursive: true });
    const run = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo", reason: "Assess delivered outcome" } },
      stepOutputs: { investigate: { ...decision, action: "no-action", proposal: null,
        evidenceRefs: source === "cited" ? [taskPath] : decision.evidenceRefs,
        rationale: "The completed intervention establishes one owner; no further work is justified." } },
    }).run();
    expect(run.status, run.error).toBe("success");
    const artifact = JSON.parse(readFileSync(join(run.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.staged).toMatchObject({ disposition: "no-action", touchedTaskQueue: false });
    const invariantInput = {
      workspaceRoot: testWorkspace, repoRoot: canonicalSnapshot, stateDir: dirname(dirname(run.runDirPath)),
      runId: basename(run.runDirPath), readState: () => ({ revision: 0, value: null }),
      workflowName: "architecture-gardener", trigger: { event: "manual", payload: {}, schemaRef: null },
      baseHead: "base", head: "writer", canonicalHead: "canonical", signal: new AbortController().signal,
    };
    const invariant = verifyGardenerSettlementAfterReconcile;
    expect(invariant(invariantInput)).toEqual({ satisfied: true });
    // An unrelated task does not invalidate this review's evidence.
    writeFileSync(join(canonicalSnapshot, "data/tasks/task-unrelated.md"), "---\nstatus: open\npriority: p2\n---\n# Unrelated work\n");
    expect(invariant(invariantInput)).toEqual({ satisfied: true });
    const canonicalTask = join(canonicalSnapshot, taskPath);
    const original = readFileSync(canonicalTask, "utf8");
    const contradicted = `${original}\nThe maintained caller still uses two owners; the claimed outcome was incorrect.\n`;
    writeFileSync(canonicalTask, contradicted);
    expect(invariant(invariantInput)).toMatchObject({ satisfied: false });
    writeFileSync(canonicalTask, original);
    writeFileSync(join(testWorkspace, taskPath), contradicted);
    expect(invariant(invariantInput)).toMatchObject({ satisfied: false });
    writeFileSync(join(testWorkspace, taskPath), original);
    expect(invariant(invariantInput)).toEqual({ satisfied: true });
  });

  it.each(["unchanged", "covered", "deferred"])("rejects stale %s task settlements without queue mutations", async (disposition) => {
    const decision = ownershipDecision();
    const seeded = stageGardenerTask({ heldTaskIds: [], workspaceRoot: testWorkspace, runId: "seed", decision });
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "publish task intent"]);
    const taskId = seeded.taskId!;
    const reviewed = disposition === "covered" ? { ...decision, action: "covered", proposal: null, existingTaskId: taskId }
      : disposition === "deferred" ? { ...decision, proposal: { ...decision.proposal!, expectedOutcome: "Also migrate the new caller." } }
        : decision;
    const canonicalSnapshot = join(testWorkspace, ".kota", "canonical-settlement");
    cpSync(join(testWorkspace, "data"), join(canonicalSnapshot, "data"), { recursive: true });
    const run = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace,
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo", reason: "Inspect current task coverage" } },
      stepOutputs: { investigate: reviewed },
    }).run();
    expect(run.status, run.error).toBe("success");
    const artifact = JSON.parse(readFileSync(join(run.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.staged).toMatchObject({ disposition, touchedTaskQueue: false });
    const invariantInput = {
      workspaceRoot: testWorkspace, repoRoot: canonicalSnapshot, stateDir: dirname(dirname(run.runDirPath)),
      runId: basename(run.runDirPath), readState: () => ({ revision: 0, value: null }),
      workflowName: "architecture-gardener", trigger: { event: "manual", payload: {}, schemaRef: null },
      baseHead: "base", head: "writer", canonicalHead: "canonical", signal: new AbortController().signal,
    };
    const invariant = verifyGardenerSettlementAfterReconcile;
    expect(invariant(invariantInput)).toEqual({ satisfied: true });
    const relativeTaskPath = join("data", "tasks", `${taskId}.md`);
    const canonicalTaskPath = join(canonicalSnapshot, relativeTaskPath);
    const original = readFileSync(canonicalTaskPath, "utf8");
    const changed = original.replace("One registration owner.", "Keep independent registration owners.");
    expect(changed).not.toBe(original);
    writeFileSync(canonicalTaskPath, changed);
    expect(invariant(invariantInput)).toMatchObject({ satisfied: false });
    writeFileSync(canonicalTaskPath, original);
    writeFileSync(join(testWorkspace, relativeTaskPath), changed);
    expect(invariant(invariantInput)).toMatchObject({ satisfied: false });
  });

  it.each(["unavailable", "omitted", "duplicate", "unknown", "unsupported-proposal", "unknown-revisit"])(
    "handles %s handoff evidence without manufacturing work", async (kind) => {
      const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "handoff-state"));
      const ref = ".kota/runs/missing/metadata.json";
      const assessment = { ref, available: false, assessment: "The source run is unavailable." };
      const run = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
        workspaceRoot: testWorkspace, ports: { state },
        trigger: { event: improvementHandoffRequested.name, payload: {
          scopeId: state.scopeId, owner: "architecture-gardener", targetScope: "module:foo",
          topicKey: "improvement:unsupported-deletion", reason: "Investigate possible duplicate ownership",
          evidenceRefs: [ref], evidenceFingerprint: "a".repeat(64), requestedBy: "progress-reviewer", idempotencyKey: kind,
        } },
        stepOutputs: { investigate: {
          action: kind === "unsupported-proposal" ? "propose" : "no-action",
          rationale: "No available evidence supports a structural change.",
          evidenceRefs: [ref], revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: kind === "unknown-revisit" ? ["invented-issue"] : [] }, existingTaskId: null,
          proposal: kind === "unsupported-proposal" ? {
            priority: "p1", mechanismKey: "foo-owner", title: "Consolidate foo ownership", problem: "Claimed duplicate ownership",
            expectedOutcome: "One owner", consumers: ["foo"], alternatives: ["Leave ownership unchanged"],
            migrationAndRetirement: "Retire the duplicate", preservationEvidenceNeeded: "Check public behavior",
            simplificationEvidenceNeeded: "Inspect the remaining owner", abstraction: null,
          } : null,
          evidenceAssessment: kind === "omitted" ? [] : kind === "duplicate" ? [assessment, assessment] : kind === "unknown" ? [{ ...assessment, ref: "invented" }] : [assessment],
        } },
      }).run();
      expect(listFullRepoTasks(testWorkspace)).toEqual([]);
      if (kind === "unavailable") {
        expect(run.status, run.error).toBe("success");
        const artifact = JSON.parse(readFileSync(join(run.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
        expect(artifact.decision.evidenceAssessment).toEqual([assessment]);
        expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value?.dispositions["src/modules/foo"]?.disposition).toBe("no-action");
      } else {
        expect(run.status).toBe("failed");
        expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value).toBeNull();
      }
    },
  );

  it("preserves a scoped handoff topic and investigates delivered counterevidence without an AST delta", async () => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "topic-state"));
    const ref = "src/modules/foo/index.ts";
    const topicKey = "improvement:foo-owner";
    const question = materializeGeneratedWorkProposal({ workspaceRoot: testWorkspace, proposal: {
      kind: "owner-question", proposalKey: topicKey, question: "Which registration owns foo?",
      reason: "Ownership was uncertain", context: "Earlier review", proposedAnswers: [],
      provenance: { source: "progress-reviewer", runId: "earlier-review", evidenceRefs: [ref] },
      origin: { kind: "workflow", workflowName: "progress-reviewer", runId: "earlier-review", stepId: "apply-actions", taskId: null },
    } });
    const queue = createGeneratedWorkQuestionQueue(testWorkspace);
    expect(queue.get(question.ownerQuestionId!)?.status).toBe("pending");
    // An unrelated observation must not consume the handoff's topic or cohort.
    mkdirSync(join(testWorkspace, "src/modules/foobar"));
    writeFileSync(join(testWorkspace, "src/modules/foobar/index.ts"), 'import "#modules/foo/index.js"; export default { dependencies: [] };');
    runGit(testWorkspace, ["add", "src/modules/foobar"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--no-gpg-sign", "-qm", "unrelated observation"]);
    const payload = {
      scopeId: state.scopeId, owner: "architecture-gardener", targetScope: "module:foo", topicKey,
      reason: "Inspect foo's registration ownership", evidenceRefs: [ref],
      evidenceFingerprint: "b".repeat(64), requestedBy: "progress-reviewer", idempotencyKey: "first",
    };
    const decision = {
      action: "propose", rationale: "Inspection of foo identifies an obsolete registration path.",
      evidenceRefs: [ref], revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: [] }, existingTaskId: null,
      proposal: {
        priority: "p1", mechanismKey: "foo-owner", title: "Retire foo's obsolete registration", problem: "Foo retains an obsolete registration path.",
        expectedOutcome: "One registration owner for foo", consumers: ["src/modules/foo/index.ts"],
        alternatives: ["Keep the current registration if consumer inspection contradicts the finding."],
        migrationAndRetirement: "Migrate foo callers and remove the obsolete path.",
        preservationEvidenceNeeded: "Check foo's public registration behavior.",
        simplificationEvidenceNeeded: "Inspect the migrated callers and retired path.", abstraction: null,
      },
      evidenceAssessment: [{ ref, available: true, assessment: "Inspected foo's current registration and callers." }],
    };
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: improvementHandoffRequested.name, payload }, stepOutputs: { investigate: decision },
    }).run();
    expect(first.status, first.error).toBe("success");
    expect(createGeneratedWorkQuestionQueue(testWorkspace).get(question.ownerQuestionId!)?.status).toBe("dismissed");
    const task = findGeneratedWorkTask(testWorkspace, topicKey)?.task;
    expect(task?.body).toContain("unverified expectation");
    expect(task?.body).not.toContain("foobar");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(1);
    const artifact = JSON.parse(readFileSync(join(first.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.observations).toEqual([]);
    const persisted = state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value;
    expect(Object.keys(persisted?.reviewedCohorts ?? {})).toEqual(["src/modules/foo"]);
    const routine = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo" } },
    }).run();
    expect(routine.status, routine.error).toBe("success");
    expect(routine.steps.investigate?.status).toBe("skipped");

    const revisedDecision = { ...decision, rationale: "New caller evidence requires extending the active outcome.",
      proposal: { ...decision.proposal, priority: "p2", expectedOutcome: "One owner including the newly discovered caller." } };
    const revisedTrigger = { event: improvementHandoffRequested.name, payload: { ...payload, evidenceFingerprint: "c".repeat(64), idempotencyKey: "revised" } };
    const deferred = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state }, trigger: revisedTrigger,
      stepOutputs: { investigate: revisedDecision },
    }).run();
    expect(deferred.status, deferred.error).toBe("success");
    expect(findGeneratedWorkTask(testWorkspace, topicKey)?.task).toEqual(task);
    expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value?.dispositions["src/modules/foo"]).toMatchObject({
      disposition: "deferred", taskId: task!.id, review: { decision: revisedDecision },
    });
    const replay = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } }, trigger: revisedTrigger,
    }).run();
    expect(replay.status, replay.error).toBe("success");
    expect(replay.steps.investigate?.status).toBe("skipped");

    // Publication retains counterevidence while the accepted intervention is active.
    const sourceRunId = "cycle-counterevidence";
    const sourceRunDir = join(testWorkspace, ".kota", "runs", sourceRunId);
    mkdirSync(sourceRunDir, { recursive: true });
    writeFileSync(join(sourceRunDir, PROGRESS_REVIEW_ARTIFACT), JSON.stringify({
      generatedAt: new Date().toISOString(),
      evidence: {
        semanticInput: { automatic: true, inputRevision: 1 },
        evidence: [{ id: "state:feedback", kind: "state", summary: "The delivery failure persisted after breaking the cycle." }],
      },
      review: {
        verdict: "needs-steering", summary: "Reassess the cycle's causal role",
        findings: { localScope: { claims: [], followUpTasks: [] }, crossScope: { claims: [], followUpTasks: [] } },
        ownerQuestions: [], handoffs: [{
          owner: "architecture-gardener", targetScope: "module:foo", topicKey,
          reason: "Later outcomes contradict the original delivery hypothesis", evidenceIds: ["state:feedback"],
        }],
      },
    }));
    const pending = publishProgressReview({
      scopeRoot: testWorkspace, sourceRunId, currentState: emptyProgressReviewConsumptionState(testWorkspace),
    });
    expect(pending.handoffs).toEqual([]);
    expect(pending.nextState.proposalObservations[0]?.pendingHandoff).toBeDefined();
    moveTaskById(testWorkspace, task!.id, "done");
    runGit(testWorkspace, ["add", "data/tasks"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test",
      "commit", "--quiet", "--no-gpg-sign", "-m", "complete intervention"]);
    const delivered = publishProgressReview({
      scopeRoot: testWorkspace, sourceRunId,
      currentState: decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(pending.nextState)), testWorkspace),
    });
    expect(delivered.handoffs).toHaveLength(1);
    const handoff = delivered.handoffs[0]!;

    const followUpDecision = {
      action: "no-action", rationale: "The intervention did not resolve delivery friction; no further structural action is supported.",
      evidenceRefs: handoff.evidenceRefs, revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: [] }, existingTaskId: null, proposal: null,
      evidenceAssessment: handoff.evidenceRefs.map((ref) => ({ ref, available: true, assessment: "Later outcomes contradict the original causal claim." })),
    };
    // Consume terminal task evidence first so it cannot itself explain handoff admission.
    const settled = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo" } },
      stepOutputs: { investigate: {
        action: "no-action", rationale: "The linked task is complete; preserve its evidence for later comparison.",
        evidenceRefs: [ref], revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: [] }, existingTaskId: null, proposal: null,
      } },
    }).run();
    expect(settled.status, settled.error).toBe("success");
    const followUp = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
      trigger: { event: improvementHandoffRequested.name, payload: {
        ...payload, ...handoff, idempotencyKey: "later",
      } }, stepOutputs: { investigate: followUpDecision },
    }).run();
    expect(followUp.status, followUp.error).toBe("success");
    const followUpArtifact = JSON.parse(readFileSync(join(followUp.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(followUpArtifact.decision).toEqual(followUpDecision);
    expect(findGeneratedWorkTask(testWorkspace, topicKey)?.task.state).toBe("done");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(1);
    expect(publishProgressReview({
      scopeRoot: testWorkspace, sourceRunId,
      currentState: decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(delivered.nextState)), testWorkspace),
    }).handoffs).toEqual([]);

    // A later assessed proposal must actually reach the shared task lifecycle.
    const canonicalSnapshot = join(testWorkspace, ".kota", "canonical-before-reopen");
    cpSync(join(testWorkspace, "data"), join(canonicalSnapshot, "data"), { recursive: true });
    const reopened = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: improvementHandoffRequested.name, payload: { ...payload, evidenceFingerprint: "d".repeat(64), idempotencyKey: "new-caller" } },
      stepOutputs: { investigate: revisedDecision },
    }).run();
    expect(reopened.status, reopened.error).toBe("success");
    expect(findGeneratedWorkTask(testWorkspace, topicKey)?.task).toMatchObject({ id: task!.id, state: "open", priority: "p2" });
    expect(findGeneratedWorkTask(testWorkspace, topicKey)?.task.body).toContain("newly discovered caller");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(1);
    expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value?.dispositions["src/modules/foo"]?.disposition).toBe("applied");
    const invariantInput = {
      workspaceRoot: testWorkspace, repoRoot: canonicalSnapshot, stateDir: dirname(dirname(reopened.runDirPath)),
      runId: basename(reopened.runDirPath), readState: () => ({ revision: 0, value: null }),
      workflowName: "architecture-gardener", trigger: { ...revisedTrigger, schemaRef: null }, baseHead: "base", head: "writer", canonicalHead: "canonical",
      signal: new AbortController().signal,
    };
    expect(verifyGardenerSettlementAfterReconcile(invariantInput)).toEqual({ satisfied: true });
    // Another writer reopened the canonical task after this investigation.
    expect(verifyGardenerSettlementAfterReconcile({ ...invariantInput, repoRoot: testWorkspace })).toMatchObject({ satisfied: false });
    // A repair cannot retire the proposed task and still publish an applied disposition.
    moveTaskById(testWorkspace, task!.id, "done");
    expect(verifyGardenerSettlementAfterReconcile(invariantInput)).toMatchObject({ satisfied: false });
  });

  it("investigates an empty request as no action and suppresses the same cohort after restart", async () => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "test-state"));
    const trigger = { event: architectureReviewRequested.name, payload: { scopeId: state.scopeId, targetScope: "repo", reason: "Review architecture" } };
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state },
      stepOutputs: { investigate: { action: "no-action", rationale: "Only one maintained implementation and no delivery evidence.", evidenceRefs: ["src/modules/foo/index.ts"], revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: [] }, existingTaskId: null, proposal: null } },
    }).run();
    expect(first.status, first.error).toBe("success");
    expect(listFullRepoTasks(testWorkspace)).toHaveLength(0);
    const artifact = JSON.parse(readFileSync(join(first.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.observations).toEqual([]);
    expect(artifact.decision.action).toBe("no-action");
    expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value?.dispositions.repo?.disposition).toBe("no-action");
    const restarted = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
    }).run();
    expect(restarted.status, restarted.error).toBe("success");
    expect(restarted.steps.investigate?.status).toBe("skipped");
  });

  it("investigates a changed structural/friction cohort once through the durable issue projection", async () => {
    writeFileSync(join(testWorkspace, "src/core/bad.ts"), 'import "#modules/foo/index.js";');
    runGit(testWorkspace, ["add", "src/core/bad.ts"]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "structural evidence"]);
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "issue-state"));
    const observation = buildAutonomyIssueObservation({
      kind: "present", rootCauseKey: "workflow:builder:module-load", observedAt: "2026-09-09T10:00:00Z",
      source: { kind: "workflow", id: "builder", workflow: "builder" }, severity: "error", actionability: "local-code",
      labels: ["workflow-failure"], summaries: ["Delivery failed while loading foo"], evidenceRefs: [{ kind: "run", ref: ".kota/runs/failed-build" }],
      observationCount: 1, signalIds: ["module-load-failure"],
    });
    const projection = applyAutonomyIssueObservations({ current: emptyAutonomyIssueProjection(), observations: [observation] }).projection;
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, 0, projection);
    const trigger = { event: "workflow.completed", payload: { workflow: "builder", scopeId: state.scopeId } };
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state },
      stepOutputs: { investigate: { action: "no-action", rationale: "No shared mechanism established; a changed loader failure could alter this judgment.", evidenceRefs: ["src/core/bad.ts", ".kota/runs/failed-build"], revisit: { reason: "Revisit changed source ownership or module-loader failure kind.", deliveryIssueKeys: [observation.issueKey] }, existingTaskId: null, proposal: null } },
    }).run();
    expect(first.status, first.error).toBe("success");
    const evidence = JSON.parse(readFileSync(join(first.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(evidence.observations.some((o: { kind: string }) => o.kind === "delivery-friction")).toBe(true);
    const churn = applyAutonomyIssueObservations({ current: projection, observations: [
      buildAutonomyIssueObservation({ ...observation, signalIds: ["repeated-loader"], observationCount: 20,
        summaries: ["Loader failure repeated 20 times"], observedAt: "2026-09-09T11:00:00Z" }),
      buildAutonomyIssueObservation({ ...observation, signalIds: ["unrelated"], rootCauseKey: "workflow:builder:unrelated-provider", severity: "warning" }),
    ] }).projection;
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, 1, churn);
    const repeated = await new WorkflowScenarioDriver(architectureGardenerWorkflow, { workspaceRoot: testWorkspace, trigger, ports: { state } }).run();
    expect(repeated.status, repeated.error).toBe("success");
    expect(repeated.steps.investigate?.status).toBe("skipped");
    const changed = applyAutonomyIssueObservations({ current: churn, observations: [
      buildAutonomyIssueObservation({ ...observation, signalIds: ["changed-loader"], severity: "warning", observedAt: "2026-09-09T12:00:00Z" }),
    ] }).projection;
    state.compareAndSet(AUTONOMY_ISSUE_PROJECTION_STATE_KEY, 2, changed);
    const changedReview = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
      stepOutputs: { investigate: evidence.decision },
    }).run();
    expect(changedReview.status, changedReview.error).toBe("success");
    expect(changedReview.steps.investigate?.status).toBe("success");
    const settled = await new WorkflowScenarioDriver(architectureGardenerWorkflow, { workspaceRoot: testWorkspace, trigger, ports: { state } }).run();
    expect(settled.status, settled.error).toBe("success");
    expect(settled.steps.investigate?.status).toBe("skipped");
  });

  it("uses idle capacity despite retained tasks and inbox without repeating a settled review", async () => {
    writeFileSync(join(testWorkspace, "src/core/bad.ts"), 'import "#modules/foo/index.js";');
    mkdirSync(join(testWorkspace, "data/inbox"));
    writeFileSync(join(testWorkspace, "data/inbox/task-capture.md"), "Investigate a captured failure.\n");
    writeFileSync(join(testWorkspace, "data/tasks/task-retained.md"), "---\nstatus: open\npriority: p1\n---\n# Retained delivery\n\nPreserve the existing delivery contract while its owner is waiting.\n");
    runGit(testWorkspace, ["add", "."]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "structural evidence"]);
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "idle-state"));
    const database = new RunStateDatabase(state.stateDir);
    const now = new Date().toISOString();
    const { epoch } = database.beginDaemonSession(now);
    for (const [id, resource] of [["held-builder", "task:task-retained"], ["held-sorter", "autonomy:inbox-triage"]] as const) {
      database.admitRun({ id, scopeId: state.scopeId, workflow: id === "held-builder" ? "builder" : "inbox-sorter", repository: "write",
        trigger: { event: "manual", schemaRef: null, payload: {} }, resources: [resource], admittedAt: now });
      database.startRun(id, epoch, now);
      database.suspendRun({ runId: id, epoch, state: "waiting", suspendedAt: now });
    }
    database.close();
    const review = () => new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger: { event: "autonomy.queue.empty", payload: {} },
      ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
      stepOutputs: { investigate: { action: "no-action", rationale: "The import requires caller evidence before proposing a change.",
        evidenceRefs: ["src/core/bad.ts"], revisit: { reason: "Changed import ownership.", deliveryIssueKeys: [] },
        existingTaskId: null, proposal: null } },
    }).run();
    const first = await review();
    expect(first.status, first.error).toBe("success");
    expect(first.steps.investigate.status).toBe("success");
    const repeated = await review();
    expect(repeated.status, repeated.error).toBe("success");
    expect(repeated.steps.investigate.status).toBe("skipped");
    expect(listFullRepoTasks(testWorkspace).map((task) => task.id)).toEqual(["task-retained"]);
  });

  it.each(["task", "inbox"])("keeps newly available %s work ahead of an idle gardener request", async (supply) => {
    writeFileSync(join(testWorkspace, "src/core/bad.ts"), 'import "#modules/foo/index.js";');
    const path = supply === "task" ? "data/tasks/task-independent.md" : "data/inbox/task-capture.md";
    mkdirSync(dirname(join(testWorkspace, path)), { recursive: true });
    writeFileSync(join(testWorkspace, path), supply === "task"
      ? "---\nstatus: open\npriority: p1\n---\n# Deliver the independent outcome\n\nOperators can inspect failure evidence from the status view.\n"
      : "Investigate the captured failure.\n");
    runGit(testWorkspace, ["add", "."]);
    runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "available delivery"]);
    const result = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger: { event: "autonomy.queue.empty", payload: {} },
    }).run();
    expect(result.status, result.error).toBe("success");
    expect(result.steps.investigate.status).toBe("skipped");
  });

  it.each(["src/modules/foo", "module:foo", "src/modules/foo/index.ts"])(
    "readmits %s for changed imports and clone sites, but suppresses unrelated or repeated evidence",
    async (targetScope) => {
      const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "target-state"));
      const review = async (target = targetScope) => {
        const result = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
          workspaceRoot: testWorkspace,
          trigger: { event: architectureReviewRequested.name, payload: { scopeId: state.scopeId, targetScope: target } },
          ports: { state: { stateDir: state.stateDir, scopeId: state.scopeId } },
          stepOutputs: { investigate: { action: "no-action", rationale: "These observations still need caller evidence before consolidation.",
            evidenceRefs: ["src/modules/foo/index.ts"], revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: [] }, existingTaskId: null, proposal: null } },
        }).run();
        expect(result.status, result.error).toBe("success");
        const artifact: { observations: ArchitectureObservation[] } = JSON.parse(
          readFileSync(join(result.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
        return { investigated: result.steps.investigate?.status === "success", observations: artifact.observations };
      };
      const changeSource = (path: string, source: string) => {
        writeFileSync(join(testWorkspace, path), source);
        runGit(testWorkspace, ["add", path]);
        runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--no-gpg-sign", "-qm", "change evidence"]);
      };

      expect((await review()).investigated).toBe(true);
      // A sibling with the same prefix must not change this target's cohort.
      mkdirSync(join(testWorkspace, "src/modules/foo-other"));
      changeSource("src/modules/foo-other/index.ts", 'import "#modules/foo/index.js"; export default { dependencies: [] };');
      expect(await review()).toEqual({ investigated: false, observations: [] });

      const source = 'import "#modules/foo-other/index.js"; export default { dependencies: [] };';
      changeSource("src/modules/foo/index.ts", source);
      const changedImport = await review();
      expect(changedImport.investigated).toBe(true);
      expect(changedImport.observations.map((observation) => observation.kind)).toEqual(["undeclared-runtime-cross-module-import"]);
      expect((await review(targetScope === "module:foo" ? "./src/modules/foo/" : targetScope)).investigated).toBe(false);

      const clone = 'export function compute(value: number) { const next = value + 1; const doubled = next * 2; return doubled; }';
      changeSource("src/core/clone.ts", clone);
      changeSource("src/modules/foo/index.ts", `${source}\n${clone}`);
      const changedClone = await review();
      expect(changedClone.investigated).toBe(true);
      expect(changedClone.observations.find((observation) => observation.kind === "duplicated-implementation-chunk")?.evidence.sites)
        .toEqual(expect.arrayContaining([expect.objectContaining({ file: "src/modules/foo/index.ts" }), expect.objectContaining({ file: "src/core/clone.ts" })]));
      expect((await review()).investigated).toBe(false);
      expect(listFullRepoTasks(testWorkspace)).toEqual([]);
    },
  );

  it("retains a staged proposal when another task owner appears before publication", async () => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "publication-state"));
    const runId = "gardener-publication-race";
    vi.spyOn(workflowCommands, "createWorkflowCommandRunner").mockImplementation((options) => async (input) => {
      const cwd = input.cwd ?? options.cwd;
      assertTaskQueueValid(cwd);
      const task = listFullRepoTasks(cwd)[0]!;
      const database = new RunStateDatabase(state.stateDir);
      try {
        if (!database.getRun("retained-builder")) {
          database.admitRun({
            id: "retained-builder", scopeId: state.scopeId, workflow: "builder", repository: "write",
            trigger: { event: "manual", schemaRef: null, payload: {} },
            resources: [`task:${task.id}`], admittedAt: new Date().toISOString(),
            notBeforeAt: "9999-01-01T00:00:00.000Z",
          });
        }
      } finally { database.close(); }
      return successfulWorkflowCommandRun({ ...input, cwd });
    });
    const run = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, runId, ports: { state },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo" } },
      stepOutputs: { investigate: {
        action: "propose", rationale: "The foo consumer has two competing registrations.",
        revisit: { reason: "Inspect changes to registration ownership", deliveryIssueKeys: [] },
        evidenceRefs: ["src/modules/foo/index.ts"], existingTaskId: null,
        proposal: {
          priority: "p2", mechanismKey: "foo-registration", title: "Consolidate foo registration",
          problem: "Two registration paths can disagree.", expectedOutcome: "Foo uses one registration owner.",
          consumers: ["foo"], alternatives: ["Retain separate owners if their behavior differs."],
          migrationAndRetirement: "Move callers and remove the duplicate registration.",
          preservationEvidenceNeeded: "The existing loader still discovers foo.",
          simplificationEvidenceNeeded: "Inspect the remaining registration path.", abstraction: null,
        },
      } },
    }).run();
    expect(run.status).toBe("failed");
    expect(listFullRepoTasks(testWorkspace)).toEqual([]);
    expect(listFullRepoTasks(run.workspaceDir)).toHaveLength(1);
    expect(state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value).toBeNull();
    const artifact = JSON.parse(readFileSync(join(run.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(artifact.staged).toMatchObject({ touchedTaskQueue: true, disposition: "applied" });
    expect(run.error).toBe("integration-invariant-failed");
  });

});
