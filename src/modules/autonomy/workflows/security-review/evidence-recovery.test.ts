import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import dispatcher from "../dispatcher/workflow.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { scopePolicySnapshotForTest } from "../scope-improver/scope-policy-test-support.js";
import { collectSecurityEvidenceRecovery, reconcileSecurityEvidenceRecovery } from "./evidence-recovery.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY, validateSecurityReviewState } from "./review-state.js";
import review from "./workflow.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

let fixture: SecurityReviewProjectFixture;
beforeEach(() => { fixture = new SecurityReviewProjectFixture(); });
afterEach(() => fixture.cleanup());

it("parks the cited malformed invariant durably while runtime.idle routes eligible work", async () => {
  fixture.writeProjectFile("data/tasks/task-independent.md", "---\nstatus: open\npriority: p0\n---\n# Independent repair\n\nRepair the independent boundary.\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"), deriveDirectoryScopeId(fixture.workspaceRoot));
  const original = { runId: "2026-09-11T04-24-51-248Z-security-review-t7qlj3", finding: {
    ...fixture.confirmedFindingForClaim("Retained disclosure"), id: "[redacted]", violatedInvariant: "[redacted]",
  } };
  const { recovery: _recovery, ...initial } = decodeSecurityReviewState(null);
  state.compareAndSet(SECURITY_REVIEW_STATE_KEY, 0, { ...initial, version: 2, pending: [original] });
  expect(() => validateSecurityReviewState({ ...initial, version: 3, recovery: [], pending: [original] })).toThrow();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Each scenario opens a new runtime session against the same SQLite owner.
    const result = await new WorkflowScenarioDriver(dispatcher, {
      workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
      scopePolicySnapshot: scopePolicySnapshotForTest(fixture.workspaceRoot),
      trigger: { event: "runtime.idle", payload: {} },
    }).run();
    expect(result.status, result.error).toBe("success");
    expect(result.emitted).toContainEqual(expect.objectContaining({ event: "autonomy.queue.available", payload: expect.objectContaining({ taskId: "task-independent" }) }));
    expect(result.emitted.some((event) => event.event === "autonomy.security-finding.publication-requested")).toBe(false);
    const persisted = validateSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    expect(persisted.pending).toEqual([]);
    expect(persisted.recovery).toEqual([{ original, disposition: "parked-invalid-evidence", reason: expect.stringContaining("finding.violatedInvariant"), attemptError: expect.stringContaining("source run is unavailable") }]);
    const decision = JSON.parse(readFileSync(join(result.runDirPath, "dispatcher-decision.json"), "utf8"));
    expect(decision.securityEvidenceRecovery).toEqual(persisted.recovery);
  }
});

it("reconciles legacy projections only from the successful scoped source and preserves provenance across restart", async () => {
  const path = "src/modules/example.ts";
  fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"), deriveDirectoryScopeId(fixture.workspaceRoot));
  const { verdict: _verdict, rationale: _rationale, ...finding } = fixture.confirmedFindingForClaim("Lock disclosure");
  finding.id = "standalone-instance-lock-credential-disclosure";
  finding.violatedInvariant = "runtime-credentials-must-not-enter-agent-context";
  finding.candidateId = `task-workflow-mutation:${path}:1`;
  const investigation = { findings: [finding], coverage: [{ path, disposition: "reviewed", rationale: "Examined production boundary" }] };
  const source = await new WorkflowScenarioDriver(review, {
    workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
    stepOutputs: {
      "investigate-candidates": investigation,
      "revalidate-findings": { findings: [{ id: finding.id, verdict: "confirmed", rationale: "Independent reproduction" }], summary: "Confirmed" },
    },
  }).run();
  expect(source.status, source.error).toBe("success");
  const valid = validateSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
  const entry = valid.pending[0]!;
  // Recorded legacy wire form: domain artifacts survive, while durable step
  // outputs and the pending row contain their diagnostic projection.
  const metadataPath = join(source.runDirPath, "metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  // Real review metadata contains repository-wide coverage and agent records,
  // so recovery must read complete artifacts beyond the excerpt batch limit.
  metadata.diagnostics = "review context ".repeat(10_000);
  for (const [id, name] of [["record-investigation-findings", "security-review-investigation.json"], ["record-revalidation", "security-review-revalidation.json"]]) {
    const artifactPath = join(source.runDirPath, name!);
    const output = JSON.parse(readFileSync(artifactPath, "utf8"));
    metadata.steps.find((step: { id: string }) => step.id === id).output = projectEvidenceObject({ ...output, artifactPath }, "internal-storage");
  }
  writeFileSync(metadataPath, JSON.stringify(metadata));
  const original = z.json().parse(projectEvidenceObject(entry, "internal-storage"));
  const snapshot = state.read(SECURITY_REVIEW_STATE_KEY);
  state.compareAndSet(SECURITY_REVIEW_STATE_KEY, snapshot.revision, { ...valid, pending: [original] });
  const held = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
  const input = { state: held, stateDir: join(fixture.workspaceRoot, ".kota"), runtimeStateDir: state.stateDir, scopeId: state.scopeId };
  const wrongScope = await collectSecurityEvidenceRecovery({ ...input, scopeId: "different-scope" });
  expect(wrongScope[0]).toMatchObject({ disposition: "parked-invalid-evidence" });
  const recorded = readFileSync(metadataPath, "utf8");
  metadata.steps.find((step: { id: string }) => step.id === "record-revalidation").output.summary = "Different recorded judgment";
  writeFileSync(metadataPath, JSON.stringify(metadata));
  expect((await collectSecurityEvidenceRecovery(input))[0]).toMatchObject({
    original, disposition: "parked-invalid-evidence", attemptError: expect.stringContaining("does not match the retained step projection"),
  });
  writeFileSync(metadataPath, recorded);
  const observed = await collectSecurityEvidenceRecovery(input);
  expect(observed[0], JSON.stringify(observed)).toMatchObject({ original, disposition: "reconciled-from-source-artifacts", source: { entry } });
  const artifactPath = join(source.runDirPath, "security-review-revalidation.json");
  const content = readFileSync(artifactPath, "utf8");
  writeFileSync(artifactPath, `${content} `);
  const raced = structuredClone(held);
  reconcileSecurityEvidenceRecovery(raced, observed, source.runDirPath);
  expect(raced.pending).toEqual([]);
  expect(raced.recovery[0]).toMatchObject({ original, disposition: "parked-invalid-evidence", attemptError: expect.stringContaining("integrity mismatch") });
  writeFileSync(artifactPath, content);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await new WorkflowScenarioDriver(dispatcher, {
      workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
      scopePolicySnapshot: scopePolicySnapshotForTest(fixture.workspaceRoot),
    }).run();
    expect(result.status, result.error).toBe("success");
    const persisted = validateSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    expect(persisted.pending).toEqual([entry]);
    expect(persisted.recovery).toEqual(observed);
  }
});
