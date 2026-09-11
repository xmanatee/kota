import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { listFullRepoTasks, moveTaskById, writeRepoTaskFile } from "#modules/repo-tasks/repo-tasks-domain.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { architectureReviewRequested } from "./events.js";
import { GARDENER_STATE_KEY } from "./gardener-state.js";
import type { ArchitectureGardenerRunState, ArchitectureObservation } from "./types.js";
import architectureGardenerWorkflow, {
  ARCHITECTURE_GARDENER_RUN_ARTIFACT,
} from "./workflow.js";

function runGit(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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

  it.each(["unavailable", "omitted", "duplicate", "unknown", "unsupported-proposal"])(
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
        stepOutputs: { investigate: { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] },
          action: kind === "unsupported-proposal" ? "propose" : "no-action",
          rationale: "No available evidence supports a structural change.",
          evidenceRefs: [ref], existingTaskId: null,
          proposal: kind === "unsupported-proposal" ? { priority: "p2",
            mechanismKey: "foo-owner", title: "Consolidate foo ownership", problem: "Claimed duplicate ownership",
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
    const decision = { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] },
      action: "propose", rationale: "Inspection of foo identifies an obsolete registration path.",
      evidenceRefs: [ref], existingTaskId: null,
      proposal: { priority: "p2",
        mechanismKey: "foo-owner", title: "Retire foo's obsolete registration", problem: "Foo retains an obsolete registration path.",
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
    const task = findGeneratedWorkTask(testWorkspace, topicKey)?.task;
    expect(task?.body).toContain("unverified expectation");
    expect(queue.get(question.ownerQuestionId!)?.status).toBe("dismissed");
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

    const followUpDecision = { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] },
      action: "no-action", rationale: "The intervention did not resolve delivery friction; no further structural action is supported.",
      evidenceRefs: handoff.evidenceRefs, existingTaskId: null, proposal: null,
      evidenceAssessment: handoff.evidenceRefs.map((ref) => ({ ref, available: true, assessment: "Later outcomes contradict the original causal claim." })),
    };
    // Consume terminal task evidence first so it cannot itself explain handoff admission.
    const settled = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, ports: { state },
      trigger: { event: architectureReviewRequested.name, payload: { targetScope: "module:foo" } },
      stepOutputs: { investigate: { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] },
        action: "no-action", rationale: "The linked task is complete; preserve its evidence for later comparison.",
        evidenceRefs: [ref], existingTaskId: null, proposal: null,
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
  });

  it("investigates an empty request as no action and suppresses the same cohort after restart", async () => {
    const state = createTestTransactionalRunState(join(testWorkspace, ".kota", "test-state"));
    const trigger = { event: architectureReviewRequested.name, payload: { scopeId: state.scopeId, targetScope: "repo", reason: "Review architecture" } };
    const first = await new WorkflowScenarioDriver(architectureGardenerWorkflow, {
      workspaceRoot: testWorkspace, trigger, ports: { state },
      stepOutputs: { investigate: { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] }, action: "no-action", rationale: "Only one maintained implementation and no delivery evidence.", evidenceRefs: ["src/modules/foo/index.ts"], existingTaskId: null, proposal: null } },
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
        revisit: { reason: "Inspect changes to registration ownership", observationIds: [] },
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
    expect(artifact.staged).toMatchObject({ touchedTaskQueue: true, disposition: "proposed" });
    expect(run.error).toBe("integration-invariant-failed");
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
      stepOutputs: { investigate: { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] }, action: "no-action", rationale: "The loader failure and the import need separate owner investigation; no shared mechanism established.", evidenceRefs: ["src/core/bad.ts", ".kota/runs/failed-build"], existingTaskId: null, proposal: null } },
    }).run();
    expect(first.status, first.error).toBe("success");
    const evidence = JSON.parse(readFileSync(join(first.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT), "utf8"));
    expect(evidence.observations.some((o: { kind: string }) => o.kind === "delivery-friction")).toBe(true);
    const repeated = await new WorkflowScenarioDriver(architectureGardenerWorkflow, { workspaceRoot: testWorkspace, trigger, ports: { state } }).run();
    expect(repeated.status, repeated.error).toBe("success");
    expect(repeated.steps.investigate?.status).toBe("skipped");
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
          stepOutputs: { investigate: { revisit: { reason: "Revisit when the observed boundary changes", observationIds: [] }, action: "no-action", rationale: "These observations still need caller evidence before consolidation.",
            evidenceRefs: ["src/modules/foo/index.ts"], existingTaskId: null, proposal: null } },
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
      // Completion in another target must not invalidate this target's settled decision.
      writeRepoTaskFile(testWorkspace, join(testWorkspace, "data/tasks/archive/task-other-target.md"),
        "---\nstatus: done\npriority: p2\n---\n\n# Completed another target\n");
      runGit(testWorkspace, ["add", "data/tasks"]);
      runGit(testWorkspace, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "--no-gpg-sign", "-qm", "complete another target"]);
      const settled = state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY);
      state.compareAndSet(GARDENER_STATE_KEY, settled.revision, {
        ...settled.value!, linkedTaskIds: ["task-other-target"],
      });
      expect((await review()).investigated).toBe(false);
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
      expect(listFullRepoTasks(testWorkspace).map(({ id, state }) => ({ id, state })))
        .toEqual([{ id: "task-other-target", state: "done" }]);
    },
  );

});
