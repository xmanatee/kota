import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { improvementHandoffRequested } from "#modules/autonomy/improvement-handoff.js";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { progressReviewOwnerQuestionProposal, progressReviewResolutionProposal } from "../progress-reviewer/progress-review/action-writers.js";
import { collectProgressReviewEvidence } from "../progress-reviewer/progress-review/collect.js";
import { PROGRESS_REVIEW_ARTIFACT } from "../progress-reviewer/progress-review.js";
import { decodeProgressReviewConsumptionState, emptyProgressReviewConsumptionState } from "../progress-reviewer/semantic-input-state.js";
import { publishProgressReview } from "../progress-reviewer/semantic-publication.js";
import {
  applyScopeImprovementRecommendations,
  collectScopeImprovementInputs,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
} from "./scope-improvement.js";
import { scopeImprovementProposalKey } from "./scope-improvement-actions.js";
import { completeScopeImprovementInput, decodeScopeImprovementState, emptyScopeImprovementState } from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

const NOW = new Date("2026-06-04T12:00:00.000Z");

function makeScope(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-scope-improver-actions-${label}-`));
  for (const state of ["open", "open", "open", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  writeFileSync(join(dir, "data", "tasks", "AGENTS.md"), "# Tasks\n");
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function trigger(files: string[]) {
  return {
    event: "autonomy.scope-improvement.requested",
    schemaRef: null,
    payload: { boundary: "initial-onboarding", evidenceRefs: files, reason: "Initial guidance discovery" },
  };
}

function runCycle(workspaceRoot: string, files: string[]) {
  const inputs = collectScopeImprovementInputs({
    workspaceRoot,
    state: emptyScopeImprovementState(deriveDirectoryScopeId(workspaceRoot)),
    trigger: trigger(files),
    now: NOW,
    scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
  });
  const candidates = discoverScopeImprovementCandidates(inputs);
  const evidence = gatherScopeImprovementEvidence({ inputs, candidates });
  const recommendations = recommendScopeImprovements({ inputs, evidence });
  const actions = applyScopeImprovementRecommendations({
    workspaceRoot,
    runId: "test-run",
    inputs,
    recommendations,
  });
  return { recommendations, actions };
}

describe("scope improvement actions", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const dir = makeScope(label);
    scopeRoots.push(dir);
    return dir;
  }

  it("creates a normal task for missing guidance in a task-proposal posture", () => {
    const workspaceRoot = track("question");
    const result = runCycle(workspaceRoot, ["plans/trip.txt"]);

    expect(result.actions.ownerQuestionIds).toEqual([]);
    expect(result.actions.applied).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "created-task" })]),
    );
    expect(result.actions.createdTaskIds).toHaveLength(1);
    expect(existsSync(join(
      workspaceRoot,
      "data",
      "tasks",
      `${result.actions.createdTaskIds[0]}.md`,
    ))).toBe(true);
  });

  it("turns task candidates into owner questions in observe posture", () => {
    const workspaceRoot = track("observe");
    const inputs = collectScopeImprovementInputs({
      workspaceRoot,
      state: emptyScopeImprovementState(deriveDirectoryScopeId(workspaceRoot)),
      trigger: trigger(["src/feature.ts"]),
      now: NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot, [{
        scopeId: deriveDirectoryScopeId(workspaceRoot),
        reason: "Observe-only onboarding posture",
        autonomy: { defaultMode: "passive", maxMode: "passive" },
        writes: { mode: "none" },
      }]),
    });
    const recommendations = recommendScopeImprovements({
      inputs,
      evidence: {
        generatedAt: inputs.generatedAt,
        scope: inputs.scope,
        triggerKind: inputs.triggerKind,
        triggerEvent: inputs.triggerEvent,
        evidence: [],
        candidates: [{
          id: "candidate",
          signature: "candidate-signature",
          title: "Improve the scope",
          summary: "Evidence supports a scoped improvement.",
          evidenceIds: [],
          preferredAction: "create-task",
          task: {
            problem: "The scope has a gap.",
            desiredOutcome: "The gap is addressed.",
            constraints: [],
            howWeWillKnow: [],
          },
        }],
      },
    });

    expect(inputs.config.posture).toBe("observe");
    expect(recommendations).toEqual([
      expect.objectContaining({ kind: "owner-question" }),
    ]);
    const actions = applyScopeImprovementRecommendations({
      workspaceRoot,
      runId: "observe-run",
      inputs,
      recommendations,
    });
    expect(actions).toMatchObject({
      requiresCommit: false,
      parkedReason: null,
      applied: [expect.objectContaining({ kind: "owner-question-pending" })],
    });
  });

  it("resolves write-denied supervised policy to observe posture", () => {
    const workspaceRoot = track("write-denied-supervised");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const inputs = collectScopeImprovementInputs({
      workspaceRoot,
      state: emptyScopeImprovementState(scopeId),
      trigger: trigger(["src/feature.ts"]),
      now: NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot, [{
        scopeId,
        reason: "Repository writes were revoked after onboarding.",
        autonomy: { defaultMode: "supervised", maxMode: "supervised" },
        writes: { mode: "none" },
      }]),
    });

    expect(inputs.config.posture).toBe("observe");
  });

  it("commits the task drop when one proposal changes to an owner question", () => {
    const workspaceRoot = track("task-to-question");
    const inputs = collectScopeImprovementInputs({
      workspaceRoot,
      state: emptyScopeImprovementState(deriveDirectoryScopeId(workspaceRoot)),
      trigger: trigger(["src/feature.ts"]),
      now: NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });
    const signature = "scope-guidance-choice";
    const created = applyScopeImprovementRecommendations({
      workspaceRoot,
      runId: "task-run",
      inputs,
      recommendations: [{
        kind: "create-task",
        signature,
        title: "Clarify scope guidance",
        summary: "The scope needs one durable policy.",
        evidenceIds: [],
        task: {
          problem: "Scope guidance is ambiguous.",
          desiredOutcome: "One policy is selected.",
          constraints: ["Preserve the stable proposal identity."],
          howWeWillKnow: [
            "The selected policy is documented and its behavior is observable.",
          ],
        },
      }],
    });
    const taskId = created.createdTaskIds[0]!;

    const changed = applyScopeImprovementRecommendations({
      workspaceRoot,
      runId: "question-run",
      inputs,
      recommendations: [{
        kind: "owner-question",
        signature,
        question: "Which scope policy should KOTA apply?",
        reason: "Two valid policies have different operator effects.",
        evidenceIds: [],
        proposedAnswers: ["Policy A", "Policy B"],
      }],
    });

    expect(changed.requiresCommit).toBe(true);
    expect(changed.applied).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "dropped-task", taskId })]),
    );
    expect(
      existsSync(join(workspaceRoot, "data", "tasks", "archive", `${taskId}.md`)),
    ).toBe(true);
  });

  it.each([false, true].flatMap((automatic) =>
    ["resolution", "owner-question"].map((disposition) => ({ automatic, disposition })),
  ))("reassesses handoff evidence and cancels it after $disposition (automatic: $automatic)", ({ automatic, disposition }) => {
    const root = track("systemic-handoff");
    const scopeId = deriveDirectoryScopeId(root);
    writeFileSync(join(root, "AGENTS.md"), "# Existing guidance\n");
    writeFileSync(join(root, "feedback.md"), "The same correction is still needed after the guidance change.\n");
    const topicKey = "improvement:guidance-conflict";
    let publicationState = emptyProgressReviewConsumptionState(root);
    let scopeState = emptyScopeImprovementState(scopeId);
    let revision = 0;
    const publish = (refs: string[]) => {
      revision += 1;
      const sourceRunId = `systemic-${revision}`;
      const now = new Date(NOW.getTime() + revision * 1000);
      const evidence = collectProgressReviewEvidence({
        workspaceRoot: root, scopeRoot: root, stateDir: join(root, ".kota"), runtimeStateDir: join(root, ".kota"), now,
        trigger: { event: "autonomy.progress-review.requested", schemaRef: null, payload: {} },
        semanticInput: { automatic, inputRevision: automatic ? revision : null,
          boundary: automatic ? "evidence-window" : "explicit-request", shouldReview: true,
          evidenceRefs: refs, reason: "Guidance conflicts with owner feedback", deliveryAttempt: revision },
      });
      const evidenceIds = evidence.canonicalState.filter((entry) => refs.includes(entry.path ?? "")).map((entry) => entry.id);
      const runDir = join(root, ".kota", "runs", sourceRunId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, PROGRESS_REVIEW_ARTIFACT), JSON.stringify({
        generatedAt: now.toISOString(), evidence,
        review: { verdict: "needs-steering", summary: "Review guidance", ownerQuestions: [],
          findings: { localScope: { claims: [], followUpTasks: [] }, crossScope: { claims: [], followUpTasks: [] } },
          handoffs: [{ owner: "scope-improver", topicKey, targetScope: "AGENTS.md",
            reason: "Repeated owner corrections contradict this guidance", evidenceIds }],
        },
      }));
      const result = publishProgressReview({ scopeRoot: root, sourceRunId, currentState: publicationState });
      publicationState = decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(result.nextState)), root);
      expect(publishProgressReview({ scopeRoot: root, sourceRunId, currentState: publicationState }).handoffs).toEqual([]);
      return result.handoffs;
    };
    const receive = (handoff: ReturnType<typeof publish>[number], runId: string) => {
      const inputs = collectScopeImprovementInputs({ workspaceRoot: root,
        state: scopeState, now: new Date(NOW.getTime() + revision * 1000),
        scopePolicySnapshot: scopePolicySnapshotForTest(root),
        trigger: { event: improvementHandoffRequested.name, schemaRef: null, payload: handoff },
      });
      const candidates = discoverScopeImprovementCandidates(inputs);
      const recommendations = recommendScopeImprovements({ inputs, evidence: gatherScopeImprovementEvidence({ inputs, candidates }) });
      expect(recommendations).toMatchObject([{ signature: topicKey }]);
      expect(scopeImprovementProposalKey(recommendations[0]!.signature)).toBe(topicKey);
      const actions = applyScopeImprovementRecommendations({ workspaceRoot: root, runId, inputs, recommendations });
      scopeState = decodeScopeImprovementState(JSON.parse(JSON.stringify(completeScopeImprovementInput({
        current: scopeState, inputs, actions: actions.applied, sourceRunId: runId,
      }))), scopeId);
      return actions;
    };
    const first = publish(["AGENTS.md"]);
    expect(first).toHaveLength(1);
    const created = receive(first[0]!, "guidance-first");
    expect(created.createdTaskIds).toHaveLength(1);
    const taskId = created.createdTaskIds[0]!;
    moveTaskById(root, taskId, "done");
    expect(publish(["AGENTS.md"])).toEqual([]);
    expect(publish(["AGENTS.md", "AGENTS.md"])).toEqual([]);
    expect(receive({ ...first[0]!, evidenceRefs: ["new-review-artifact.json", "AGENTS.md"] }, "redelivered").requiresCommit).toBe(false);
    expect(listFullRepoTasks(root)).toMatchObject([{ id: taskId, state: "done" }]);

    const changed = publish(["feedback.md", "AGENTS.md"]);
    expect(changed).toHaveLength(1);
    expect(changed[0]!.evidenceFingerprint).not.toBe(first[0]!.evidenceFingerprint);
    const reassessed = receive(changed[0]!, "guidance-follow-up");
    expect(reassessed.applied).toMatchObject([{ kind: "updated-task", taskId, signature: topicKey }]);
    expect(listFullRepoTasks(root)).toMatchObject([{ id: taskId, state: "open", body: expect.stringContaining("feedback.md") }]);
    moveTaskById(root, taskId, "done");
    expect(publish(["AGENTS.md", "feedback.md"])).toEqual([]);
    expect(receive(changed[0]!, "follow-up-redelivered").requiresCommit).toBe(false);
    expect(listFullRepoTasks(root)).toMatchObject([{ id: taskId, state: "done" }]);
    writeFileSync(join(root, "feedback.md"), "A later operator correction contradicts the revised guidance.\n");
    const revised = publish(["AGENTS.md", "feedback.md"]);
    expect(revised).toHaveLength(1);
    expect(revised[0]!.evidenceFingerprint).not.toBe(changed[0]!.evidenceFingerprint);
    expect(receive(revised[0]!, "guidance-revised").applied).toMatchObject([{ kind: "updated-task", taskId }]);
    writeFileSync(join(root, "feedback.md"), "Another correction supports the original hypothesis.\n");
    expect(publish(["feedback.md", "AGENTS.md"])).toEqual([]);
    expect(publicationState.proposalObservations[0]?.pendingHandoff).toBeDefined();

    // A later assessment rejects the hypothesis while its older handoff is deferred.
    const sourceRunId = "rejected-hypothesis";
    const resolution = { topicKey, reason: "The measured outcome disproves the hypothesis", evidenceIds: [] };
    const question = { topicKey, question: "Should we retire this hypothesis?", reason: resolution.reason, evidenceIds: [], proposedAnswers: [] };
    revision += 1;
    const dispositionRevision = revision;
    const runDir = join(root, ".kota", "runs", sourceRunId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, PROGRESS_REVIEW_ARTIFACT), JSON.stringify({
      generatedAt: new Date(NOW.getTime() + revision * 1000).toISOString(),
      evidence: { semanticInput: { automatic, inputRevision: automatic ? revision : null } },
      review: { verdict: "on-track", summary: resolution.reason,
        ownerQuestions: disposition === "owner-question" ? [question] : [],
        resolutions: disposition === "resolution" ? [resolution] : [],
        findings: { localScope: { claims: [], followUpTasks: [] }, crossScope: { claims: [], followUpTasks: [] } } },
    }));
    // Consume a newer, unrelated review before this disposition integrates.
    // Its global watermark must not supersede the topic's retirement effects.
    const unrelatedRunDir = join(root, ".kota", "runs", "unrelated-review");
    mkdirSync(unrelatedRunDir, { recursive: true });
    revision += 1;
    writeFileSync(join(unrelatedRunDir, PROGRESS_REVIEW_ARTIFACT), JSON.stringify({
      generatedAt: new Date(NOW.getTime() + revision * 1000).toISOString(),
      evidence: { semanticInput: { automatic, inputRevision: automatic ? revision : null } },
      review: { verdict: "on-track", summary: "Unrelated evidence is insufficient", ownerQuestions: [],
        findings: { localScope: { claims: [], followUpTasks: [] }, crossScope: { claims: [], followUpTasks: [] } } },
    }));
    const unrelated = publishProgressReview({ scopeRoot: root, sourceRunId: "unrelated-review", currentState: publicationState });
    expect(unrelated.handoffs).toEqual([]);
    publicationState = decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(unrelated.nextState)), root);
    stageGeneratedWorkProposal({ workspaceRoot: root, proposal: disposition === "resolution"
      ? progressReviewResolutionProposal(resolution)
      : progressReviewOwnerQuestionProposal({ runId: sourceRunId, question }) });
    const retiredTask = listFullRepoTasks(root);
    expect(retiredTask).toMatchObject([{ id: taskId, state: "dropped" }]);
    for (const replayId of [sourceRunId, "systemic-1", `systemic-${dispositionRevision - 1}`, sourceRunId, "unrelated-review"]) {
      const result = publishProgressReview({ scopeRoot: root, sourceRunId: replayId, currentState: publicationState });
      publicationState = decodeProgressReviewConsumptionState(JSON.parse(JSON.stringify(result.nextState)), root);
      for (const handoff of result.handoffs) receive(handoff, "superseded-handoff");
      expect(listFullRepoTasks(root)).toEqual(retiredTask);
      expect(result.handoffs).toEqual([]);
      expect(publicationState.proposalObservations[0]?.pendingHandoff).toBeUndefined();
    }
  });

});
