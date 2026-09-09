import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { progressReviewTaskProposal } from "./action-writers.js";
import { applyProgressReviewActions } from "./actions.js";
import { listInterventionEvidence } from "./intervention-evidence.js";
import { currentDirectorySource, progressEvidenceWindow } from "./trigger-target.js";
import type { ProgressReviewAgentOutput, ScopedRunEvidence } from "./types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("keeps an archived intervention inspectable and allows later evidence to reject its hypothesis without reopening it", () => {
  const root = mkdtempSync(join(tmpdir(), "kota-systemic-intervention-"));
  roots.push(root);
  const source = currentDirectorySource(root, root, join(root, ".kota"));
  const task = { topicKey: "improvement:repair-yield", title: "Correct repair evidence", problem: "The missing evidence causes every repair failure", priority: "p1" as const, evidenceIds: ["run:before"], howWeWillKnow: "After integration, the same failure family disappears" };
  const review: ProgressReviewAgentOutput = { verdict: "needs-steering", summary: task.problem,
    findings: { localScope: { claims: [], followUpTasks: [task] }, crossScope: { claims: [], followUpTasks: [] } }, ownerQuestions: [] };
  const staged = stageGeneratedWorkProposal({ workspaceRoot: root, proposal: progressReviewTaskProposal({ runId: "decision", review, task }) });
  moveTaskById(root, staged.taskId!, "done");
  const runDir = join(root, ".kota", "runs", "decision");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "progress-review.json"), JSON.stringify({ review }));
  const runs: ScopedRunEvidence[] = [{ source, runId: "decision", startedMs: 0, evidence: { id: "run:decision", kind: "run", workflow: "progress-reviewer", status: "success", startedAt: "2026-01-01T00:00:00.000Z", summary: "Original review" } }];
  const refs = listInterventionEvidence(source, runs, []);
  expect(refs).toEqual(expect.arrayContaining([expect.objectContaining({ path: `data/tasks/archive/${staged.taskId}.md` })]));
  expect(refs[0]?.summary).toContain(task.howWeWillKnow);
  const laterFailure = { id: "run:after", kind: "run" as const, summary: "Same repair failure recurred after the canonical task was completed" };
  applyProgressReviewActions({ workspaceRoot: root, runId: "counterevidence", evidence: { evidence: [...refs, laterFailure] }, review: {
    verdict: "insufficient-evidence", summary: "Later failure contradicts the original causal claim; no new intervention is justified yet",
    findings: { localScope: { claims: [{ id: "refuted", claim: "The original cause was insufficient", evidenceIds: [refs[0]!.id, laterFailure.id], confidence: "high" }], followUpTasks: [] }, crossScope: { claims: [], followUpTasks: [] } }, ownerQuestions: [],
    resolutions: [{ topicKey: task.topicKey, reason: "Later outcomes refute the original hypothesis", evidenceIds: [refs[0]!.id, laterFailure.id] }],
  } });
  expect(listFullRepoTasks(root).map((record) => ({ id: record.id, state: record.state }))).toEqual([{ id: staged.taskId, state: "done" }]);
});

it("pins the comparison time range independently of when delayed evidence collection executes", () => {
  const observation = { id: "delivery", workflow: "builder", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T01:00:00.000Z", status: "success", delivery: null, errors: [], observationOnly: false };
  const request = { evidenceWindow: { fromHead: "a".repeat(40), toHead: "b".repeat(40), startedAt: "2026-02-01T00:00:00.000Z", endedAt: "2026-03-01T00:00:00.000Z", baseline: [observation], current: [], excluded: [] } };
  const before = progressEvidenceWindow(request, new Date("2026-03-01T00:00:00.000Z"));
  const delayed = progressEvidenceWindow(request, new Date("2026-09-01T00:00:00.000Z"));
  expect(delayed).toEqual(before);
  expect(delayed.startedAt).toBe(observation.startedAt);
  expect(delayed.endedAt).toBe(request.evidenceWindow.endedAt);
});
