import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { collectSecurityReviewGitEvidence, inspectSecurityReviewDue, reconcileSecurityReviewObservation } from "./due-check.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY } from "./review-state.js";
import workflow from "./workflow.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

// One incident, exported from run 2026-09-10T02-03-16-653Z-security-review-zlzeed
// and dlq-01ad2e02-aaca-4d98-bf02-0ebeacbf5a0b (same failure timestamp).
const refusal = "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber";
let fixture: SecurityReviewProjectFixture;
afterEach(() => fixture?.cleanup());

it.each(["investigate-candidates", "revalidate-findings"])("persists %s refusal without coverage or timed readmission, then reviews an explicit retry", async (failedStep) => {
  fixture = new SecurityReviewProjectFixture();
  const path = "src/modules/example.ts";
  const cappedPath = "src/service/pending.ts";
  fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
  fixture.writeProjectFile(cappedPath, "export const pending = true;\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
  const initial = decodeSecurityReviewState(null);
  initial.pending.push({ runId: "earlier-confirmed-review", finding: { ...fixture.confirmedFindingForClaim("Pending task authority evidence"), verdict: "confirmed" } });
  state.compareAndSet(SECURITY_REVIEW_STATE_KEY, 0, initial);
  const evidence = { id: "original-request", paths: [path], critical: true, reason: "Defensive task authority review" };
  const { verdict: _verdict, rationale: _rationale, ...finding } = initial.pending[0]!.finding;
  finding.candidateId = `reported-boundary:${path}:1`;
  const coverage = [{ path, disposition: "reviewed", rationale: "Examined task authority" }];
  const runId = `refused-${failedStep}`;
  let calls = 0;
  const blocked = await new WorkflowScenarioDriver(workflow, {
    runId, workspaceRoot: fixture.workspaceRoot,
    trigger: { event: "autonomy.security-review.requested", payload: { evidence } },
    ports: { state, runCommand: runGitEvidenceCommand, runAgent: async ({ stepId }) => {
      calls += 1;
      if (stepId === failedStep) throw new Error(`Agent step "${stepId}" failed (codex_cli_error): ${refusal}`);
      return { findings: [finding], coverage };
    } },
  }).run();
  expect(blocked.status, blocked.error).toBe("success");
  expect(calls).toBe(failedStep === "investigate-candidates" ? 1 : 2);
  const outcome = JSON.parse(readFileSync(join(blocked.runDirPath, "security-review-outcome.json"), "utf8"));
  expect(outcome).toMatchObject({ outcome: "blocked", reason: "provider-policy-refusal", coverage: "unknown", runId, stepId: failedStep, reviewedPaths: [], pendingFindingCount: 1 });
  expect(outcome.diagnostic).toContain(refusal);
  expect(outcome.prerequisite).toContain("explicit security-review evidence request");
  expect(outcome.unknownPaths).toEqual(expect.arrayContaining([path, cappedPath]));
  expect(JSON.parse(readFileSync(join(blocked.runDirPath, "metadata.json"), "utf8")).status).toBe("completed-with-warnings");
  // Each state read opens and closes the real SQLite owner; the next scenario
  // constructs a fresh coordinator/lifecycle over the same persisted database.
  const held = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
  expect(held.reviewed).toEqual({});
  expect(held.lastReview).toBeNull();
  expect(held.pending).toEqual(initial.pending);
  expect(held.evidenceRequests).toEqual([{ request: evidence, reviewed: {} }]);
  expect(held.unavailable[path]).toMatchObject({ runId, requestIds: [evidence.id], rationale: `${outcome.diagnostic}\n${outcome.prerequisite}` });
  const git = await collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot, stateDir: state.stateDir, runCommand: runGitEvidenceCommand, reviewState: held });
  const inspection = inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0, now: new Date("2030-01-01") }, git);
  expect(inspection.due).toBe(false);
  expect(reconcileSecurityReviewObservation({ observedState: held, currentState: held, git, inspection, stateDir: state.stateDir }).due.due).toBe(false);
  // Also reject an in-flight dispatch observation taken before refusal settled.
  const staleGit = await collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot, stateDir: state.stateDir, runCommand: runGitEvidenceCommand, reviewState: initial });
  expect(reconcileSecurityReviewObservation({ observedState: initial, currentState: held, git: staleGit, inspection, stateDir: state.stateDir }).due.due).toBe(false);
  const requestedAgain = decodeSecurityReviewState(held);
  requestedAgain.evidenceRequests.push({ request: { ...evidence, id: "authorized-new-request" }, reviewed: {} });
  expect(reconcileSecurityReviewObservation({ observedState: initial, currentState: requestedAgain, git: staleGit, inspection, stateDir: state.stateDir }).due.due).toBe(true);
  const replay = await new WorkflowScenarioDriver(workflow, {
    workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error("Unchanged blocked work must not launch"); } },
    trigger: { event: "autonomy.security-review.requested", payload: { evidence } },
  }).run();
  expect(replay.status, replay.error).toBe("success");
  expect(replay.steps["investigate-candidates"]?.status).toBe("skipped");
  expect(state.read(SECURITY_REVIEW_STATE_KEY).value).toEqual(held);

  const recovery = await new WorkflowScenarioDriver(workflow, {
    workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
    trigger: { event: "autonomy.security-review.requested", payload: { evidence: { ...evidence, id: "provider-prerequisite-resolved" } } },
    stepOutputs: { "investigate-candidates": { findings: [], coverage } },
  }).run();
  expect(recovery.status, recovery.error).toBe("success");
  const reviewed = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
  expect(reviewed.reviewed[path]?.digest).toBe(held.unavailable[path]?.digest);
  expect(reviewed.reviewedEvidenceIds).toContain("provider-prerequisite-resolved");
  expect(reviewed.unavailable[path]).toBeUndefined();
  expect(reviewed.pending).toEqual(initial.pending);
  expect(reviewed.evidenceRequests).toContainEqual({ request: evidence, reviewed: {} });
  expect(JSON.parse(readFileSync(join(blocked.runDirPath, "security-review-outcome.json"), "utf8"))).toEqual(outcome);
});

it.each([
  ['Agent step "investigate-candidates" failed (codex_cli_error): unexpected status 503 Service Unavailable', "transient provider"],
  ["Local scanner execution invariant failed", "execution"],
])("retains %s as a failed run without settling coverage (%s)", async (diagnostic) => {
  fixture = new SecurityReviewProjectFixture();
  fixture.writeProjectFile("src/modules/example.ts", "writeFileSync(taskPath, body);\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
  const result = await new WorkflowScenarioDriver(workflow, {
    workspaceRoot: fixture.workspaceRoot,
    ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error(diagnostic); } },
  }).run();
  expect(result.status).toBe("failed");
  expect(result.error).toContain(diagnostic);
  expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value)).toEqual(decodeSecurityReviewState(null));
});
