import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_MAX_STEP_OUTPUT_BYTES } from "#core/workflow/run-executor-step-shared.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY } from "./review-state.js";
import workflow from "./workflow.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

let fixture: SecurityReviewProjectFixture;
afterEach(() => fixture?.cleanup());

it("preserves repository-sized identity through persisted outputs, failed review and current-head retry", async () => {
  fixture = new SecurityReviewProjectFixture();
  const paths = Array.from({ length: 2500 }, (_, i) =>
    `src/service/${"authority-boundary-".repeat(6)}${i.toString().padStart(4, "0")}.ts`);
  for (const path of paths) fixture.writeProjectFile(path, "export const mayRead = (user) => user.permission === 'read';\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
  const evidence = { id: "large-repository-report", paths: [paths[0]!, paths[1]!], critical: true, reason: "Reported authority variants" };
  const failedRunId = "large-review-failed";
  const failed = await new WorkflowScenarioDriver(workflow, {
    runId: failedRunId, workspaceRoot: fixture.workspaceRoot,
    ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error("Provider unavailable"); } },
    trigger: { event: "autonomy.security-review.requested", payload: { evidence } },
  }).run();
  expect(failed.status).toBe("failed");
  expect(failed.steps["investigate-candidates"]?.status, failed.error).toBe("failed");
  expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewed).toEqual({});
  const originalInput = JSON.parse(readFileSync(join(failed.runDirPath, "security-review-input.json"), "utf8"));
  expect(Buffer.byteLength(JSON.stringify(originalInput.previousSurfaces))).toBeGreaterThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
  expect(Buffer.byteLength(JSON.stringify(originalInput.contentDigests))).toBeGreaterThan(DEFAULT_MAX_STEP_OUTPUT_BYTES);
  expect(Object.keys(originalInput.previousSurfaces)).toEqual(paths);

  fixture.writeProjectFile(paths[0]!, "export const mayRead = () => true;\n");
  rmSync(join(fixture.workspaceRoot, paths[1]!));
  fixture.commitProjectState("remove guards before retry");
  const retryRunId = "large-review-retry";
  let selected: string[] = [];
  const retry = await new WorkflowScenarioDriver(workflow, {
    runId: retryRunId, workspaceRoot: fixture.workspaceRoot,
    ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => {
      const packet = JSON.parse(readFileSync(join(fixture.workspaceRoot, ".kota/runs", retryRunId, "security-review-candidates.json"), "utf8"));
      selected = [...new Set<string>(packet.candidates.map((candidate: { path: string }) => candidate.path))];
      return { findings: [], coverage: selected.map((path) => ({ path, disposition: "reviewed", rationale: "Inspected caller authority" })) };
    } },
    trigger: { event: "autonomy.security-review.requested", payload: { retryOf: failedRunId } },
  }).run();
  expect(retry.status, retry.error).toBe("success");
  const input = JSON.parse(readFileSync(join(retry.runDirPath, "security-review-input.json"), "utf8"));
  expect(input.currentHead.sha).not.toBe(originalInput.currentHead.sha);
  expect(input.contentDigests[paths[0]!]).not.toBe(originalInput.contentDigests[paths[0]!]);
  expect(input.contentDigests[paths[1]!]).toBe("deleted");
  expect(input.previousSurfaces).toEqual(originalInput.previousSurfaces);
  expect(selected).toEqual(expect.arrayContaining(evidence.paths));
  const complete = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
  expect(complete.reviewedEvidenceIds).toContain(evidence.id);
  expect(Object.keys(complete.reviewed).sort()).toEqual([...selected].sort());
  expect(Object.keys(complete.unreviewedSurfaces).sort()).toEqual(paths.filter((path) => !selected.includes(path)));
  for (const path of selected) expect(complete.reviewed[path]?.digest).toBe(input.contentDigests[path]);
  for (const result of [failed, retry]) {
    const metadata = JSON.parse(readFileSync(join(result.runDirPath, "metadata.json"), "utf8"));
    expect(metadata.warnings ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "step-output-truncated" })]));
  }
}, 60_000);

it.each(["missing", "changed"])("fails closed on %s retained input instead of consuming lost coverage", async (condition) => {
  fixture = new SecurityReviewProjectFixture();
  const path = "src/service/gate.ts";
  fixture.writeProjectFile(path, "export const mayRead = () => true;\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
  const failedRunId = `input-${condition}`;
  const failed = await new WorkflowScenarioDriver(workflow, {
    runId: failedRunId, workspaceRoot: fixture.workspaceRoot,
    ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error("Provider unavailable"); } },
    trigger: { event: "autonomy.security-review.requested", payload: {
      evidence: { id: "reported-gate", paths: [path], critical: true, reason: "Missing authority check" },
    } },
  }).run();
  expect(failed.steps["investigate-candidates"]?.status, failed.error).toBe("failed");
  const artifact = join(failed.runDirPath, "security-review-retained-input.json");
  if (condition === "missing") rmSync(artifact);
  else writeFileSync(artifact, JSON.stringify({ evidenceRequest: null, unreviewedSurfaces: {} }));
  const retry = await new WorkflowScenarioDriver(workflow, {
    workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
    trigger: { event: "autonomy.security-review.requested", payload: { retryOf: failedRunId } },
  }).run();
  expect(retry.status).toBe("failed");
  expect(retry.steps["refresh-review-input"]?.status).toBe("failed");
  expect(retry.error).toContain(condition === "missing" ? "ENOENT" : "integrity mismatch");
  const after = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
  expect(after.reviewed).toEqual({});
  expect(after.reviewedEvidenceIds).toEqual([]);
});
