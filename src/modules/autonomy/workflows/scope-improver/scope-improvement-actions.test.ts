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
import {
  applyScopeImprovementRecommendations,
  collectScopeImprovementInputs,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
} from "./scope-improvement.js";
import { emptyScopeImprovementState } from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";

const NOW = new Date("2026-06-04T12:00:00.000Z");

function makeScope(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-scope-improver-actions-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
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
    payload: { evidenceRefs: files, reason: "test request" },
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

  it("stages owner questions for post-integration publication", () => {
    const workspaceRoot = track("question");
    const result = runCycle(workspaceRoot, ["plans/trip.txt"]);

    expect(result.actions.ownerQuestionIds).toEqual([]);
    expect(result.actions.applied).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "owner-question-pending" })]),
    );
    expect(existsSync(join(workspaceRoot, ".kota", "owner-questions"))).toBe(false);
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
      existsSync(join(workspaceRoot, "data", "tasks", "dropped", `${taskId}.md`)),
    ).toBe(true);
  });

});
