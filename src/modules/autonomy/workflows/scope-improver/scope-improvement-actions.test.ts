import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyScopeImprovementRecommendations,
  collectScopeImprovementInputs,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
} from "./scope-improvement.js";
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

function runCycle(projectDir: string, files: string[]) {
  const inputs = collectScopeImprovementInputs({
    projectDir,
    trigger: trigger(files),
    now: NOW,
    scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
  });
  const candidates = discoverScopeImprovementCandidates(inputs);
  const evidence = gatherScopeImprovementEvidence({ inputs, candidates });
  const recommendations = recommendScopeImprovements({ inputs, evidence });
  const actions = applyScopeImprovementRecommendations({
    projectDir,
    runId: "test-run",
    inputs,
    recommendations,
  });
  return { recommendations, actions };
}

describe("scope improvement actions", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const dir = makeScope(label);
    projectDirs.push(dir);
    return dir;
  }

  it("creates owner questions for missing guidance when edits are not allowed", () => {
    const projectDir = track("question");
    const result = runCycle(projectDir, ["plans/trip.txt"]);

    expect(result.actions.ownerQuestionIds).toHaveLength(1);
    const questionFiles = readdirSync(join(projectDir, ".kota", "owner-questions"));
    expect(questionFiles).toHaveLength(1);
    expect(
      readFileSync(join(projectDir, ".kota", "owner-questions", questionFiles[0]!), "utf-8"),
    ).toContain("What durable guidance should KOTA follow");
  });

  it("commits the task drop when one proposal changes to an owner question", () => {
    const projectDir = track("task-to-question");
    const inputs = collectScopeImprovementInputs({
      projectDir,
      trigger: trigger(["src/feature.ts"]),
      now: NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(projectDir),
    });
    const signature = "scope-guidance-choice";
    const created = applyScopeImprovementRecommendations({
      projectDir,
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
          doneWhen: ["The selected policy is documented."],
          acceptanceEvidence: ["A focused fixture proves the behavior."],
        },
      }],
    });
    const taskId = created.createdTaskIds[0]!;

    const changed = applyScopeImprovementRecommendations({
      projectDir,
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
      existsSync(join(projectDir, "data", "tasks", "dropped", `${taskId}.md`)),
    ).toBe(true);
  });

});
