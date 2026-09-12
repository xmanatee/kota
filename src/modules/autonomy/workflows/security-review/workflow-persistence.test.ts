import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { DEFAULT_MAX_STEP_OUTPUT_BYTES } from "#core/workflow/run-executor-step-shared.js";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { refreshReviewInput, scanCandidates } from "./candidate-steps.js";
import { candidateReviewInputArtifact, readSecurityReviewCandidates, refreshedReviewInputArtifact } from "./review-input-artifact.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY } from "./review-state.js";
import workflow from "./workflow.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

let fixture: SecurityReviewProjectFixture;
afterEach(() => fixture?.cleanup());

it("rejects malformed candidate packets and substitution of pinned inputs even with matching artifact hashes", () => {
  fixture = new SecurityReviewProjectFixture();
  const runDir = join(fixture.workspaceRoot, ".kota/runs/scan-boundary");
  const path = "src/modules/token-store.ts";
  const input = refreshedReviewInputArtifact.write(runDir, {
    currentHead: { kind: "commit", sha: "a".repeat(40) }, changedPaths: [path],
    contentDigests: { [path]: "b".repeat(40) }, previousSurfaces: { [path]: ["secret-handling"] },
    evidenceRequest: null, evidenceReviewed: {}, evidencePaths: [],
  });
  const candidate = { id: `secret-handling:${path}:1`, surface: "secret-handling" as const, path, line: 1, matcher: "environment" };
  const packet = { input, candidates: [candidate], candidateCount: 1, artifactPath: join(runDir, "security-review-candidates.json"), truncated: false };
  const reference = candidateReviewInputArtifact.write(runDir, packet);
  expect(readSecurityReviewCandidates(runDir, reference, input).candidates).toEqual([candidate]);
  const invalidPackets = [
    { ...packet, candidates: [{ ...candidate, surface: "[redacted]" }] },
    { ...packet, candidates: [candidate, candidate], candidateCount: 2 },
    { ...packet, candidateCount: 0 },
    { ...packet, candidates: [{ ...candidate, path: "unscanned.ts" }] },
    { ...packet, input: { ...input, runId: "other-review" } },
  ];
  for (const invalid of invalidPackets) {
    // A valid hash authenticates bytes, not their domain meaning or linkage.
    const content = JSON.stringify(invalid);
    writeFileSync(join(runDir, "security-review-scan-input.json"), content);
    const changed = { ...reference, sha256: createHash("sha256").update(content).digest("hex") };
    expect(() => readSecurityReviewCandidates(runDir, changed, input)).toThrow();
  }
});

it.each(["investigation", "revalidation", "scan-input", "input"])("rejects changed %s artifacts at atomic finalization", async (artifact) => {
  fixture = new SecurityReviewProjectFixture();
  const path = "src/modules/example.ts";
  fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
  const { verdict: _verdict, rationale: _rationale, ...finding } = fixture.confirmedFindingForClaim("Task writes lack authority");
  finding.candidateId = `task-workflow-mutation:${path}:1`;
  const result = await new WorkflowScenarioDriver({
    ...workflow,
    steps: [...workflow.steps, { id: "change-source-artifact", type: "code", run: (ctx) => {
      const artifactPath = join(ctx.workflow.runDirPath, `security-review-${artifact}.json`);
      writeFileSync(artifactPath, `${readFileSync(artifactPath, "utf8")} `);
      return null;
    } }],
  }, {
    workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
    stepOutputs: {
      "investigate-candidates": { findings: [finding], coverage: [{ path, disposition: "reviewed", rationale: "Examined boundary" }] },
      "revalidate-findings": { findings: [{ id: finding.id, verdict: "confirmed", rationale: "Independent reproduction" }], summary: "Confirmed" },
    },
  }).run();
  expect(result.status).toBe("failed");
  expect(result.error).toContain("integrity mismatch");
  expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value)).toEqual(decodeSecurityReviewState(null));
});

it("preserves repository-sized identity through persisted outputs, failed review and current-head retry", async () => {
  fixture = new SecurityReviewProjectFixture();
  const paths = Array.from({ length: 2500 }, (_, i) =>
    `src/service/token-store/${"authority-boundary-".repeat(6)}${i.toString().padStart(4, "0")}.ts`);
  for (const path of paths) fixture.writeProjectFile(path, "export const mayRead = (user) => user.permission === 'read';\nconst value = process.env.API_KEY;\n");
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
  for (const path of selected) {
    expect(complete.reviewed[path]?.digest).toBe(input.contentDigests[path]);
    expect(complete.reviewed[path]?.surfaces).toContain("secret-handling");
  }
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

// Representative pre-reference scan outputs pass through the real success
// transaction, then the runtime replays completed work from persisted artifacts.
it("recovers a retained legacy scan without rerunning completed investigation or revalidation", async () => {
  fixture = new SecurityReviewProjectFixture();
  const path = "src/modules/token-store.ts";
  fixture.writeProjectFile(path, "const value = process.env.API_KEY;\n");
  fixture.commitProjectState();
  const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
  const { verdict: _verdict, rationale: _rationale, ...finding } = fixture.confirmedFindingForClaim("Secret read lacks authority");
  finding.candidateId = `secret-handling:${path}:1`;
  finding.affectedPath = path;
  finding.evidence = [{ path, line: 1, excerpt: "const value = process.env.API_KEY;" }];
  let legacyOutputs: WorkflowFinalizationContext["stepOutputs"];
  // The incident predates writer isolation; its persisted repository contract
  // stays read-only when today's definition resumes the completed run.
  const definition = { ...workflow, repository: "read" as const, integration: undefined, finalize: (ctx: WorkflowFinalizationContext) => {
    const runDir = join(ctx.stateDir, "runs", ctx.runId);
    const packet = readSecurityReviewCandidates(runDir, ctx.stepOutputs[scanCandidates.id], refreshReviewInput.outputRequired(ctx));
    const legacy = projectEvidenceObject({
      candidates: packet.candidates, candidateCount: packet.candidateCount,
      artifactPath: packet.artifactPath, truncated: packet.truncated, head: packet.head,
      contentDigests: Object.fromEntries(packet.candidates.map(({ path }) => [path, packet.contentDigests[path]!])),
    }, "internal-storage");
    expect(legacy.candidates).toEqual([expect.objectContaining({ surface: "[redacted]" })]);
    expect(legacy.contentDigests).toEqual({ [path]: "[redacted]" });
    legacyOutputs = { ...ctx.stepOutputs, [scanCandidates.id]: legacy };
    throw new Error("Legacy finalization retained");
  } };
  const first = await new WorkflowScenarioDriver(definition, {
    workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
    stepOutputs: {
      "investigate-candidates": { findings: [finding], coverage: [{ path, disposition: "reviewed", rationale: "Examined boundary" }] },
      "revalidate-findings": { findings: [{ id: finding.id, verdict: "confirmed", rationale: "Independent reproduction" }], summary: "Confirmed" },
    },
  }).run();
  expect(first.status).toBe("failed");
  expect(first.error).toContain("Legacy finalization retained");
  expect(first.steps["investigate-candidates"]?.status).toBe("success");
  expect(first.steps["revalidate-findings"]?.status).toBe("success");
  expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewed).toEqual({});
  const input = refreshedReviewInputArtifact.read(first.runDirPath, refreshReviewInput.outputRequired({ stepOutputs: legacyOutputs! }));
  const candidatePath = join(first.runDirPath, "security-review-candidates.json");
  const originalCandidates = readFileSync(candidatePath, "utf8");
  const metadataPath = join(first.runDirPath, "metadata.json");
  const metadata = readWorkflowRunMetadataFile(metadataPath, { authorityCritical: true });
  const persistLegacyOutputs = () => writeFileSync(metadataPath, JSON.stringify({
    ...metadata, steps: metadata.steps.map((step) => ({ ...step, output: legacyOutputs![step.id] })),
  }));
  const harnessName = "security-recovery-must-not-execute";
  const unregisterHarness = registerAgentHarness({
    name: harnessName, description: "Reject agent execution during finalization replay",
    supportsMultiTurn: false, supportedHookKinds: [], askOwnerToolName: null,
    emitsAgentMessageStream: false, toolControl: "kota",
    run: async () => { throw new Error("Completed security agents must not rerun"); },
  });
  const database = RunStateDatabase.openExisting(state.stateDir);
  const bus = new EventBus();
  const { epoch } = database.beginDaemonSession(new Date().toISOString());
  let runtime!: WorkflowRuntime;
  const coordinator = new RunCoordinator({ store: database, daemonEpoch: epoch, concurrency: 1,
    execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
  });
  // Load the real finalizer; all its inputs must come from persisted metadata.
  runtime = new WorkflowRuntime({ bus, pbus: new ScopedEventBus(bus, state.scopeId),
    scopeRoot: fixture.workspaceRoot, scopeId: state.scopeId, runState: database,
    runCoordinator: coordinator, daemonEpoch: epoch,
    workflows: [{ ...workflow, moduleRoot: process.cwd(), definitionPath: "retained-security-review",
      steps: workflow.steps.map((step) => step.type === "agent" ? { ...step, harness: harnessName } : step),
    }],
  });
  const runId = first.runDirPath.split("/").at(-1)!;
  const receipt = database.getRun(runId)!.executionCompletedAt;
  expect(receipt).toEqual(expect.any(String));
  try {
    runtime.reloadWorkflowDefinitions();
    const originalOutputs = structuredClone(legacyOutputs!);
    for (const invalid of ["source", "input", "projection", "provenance", "revalidation"] as const) {
      legacyOutputs = structuredClone(originalOutputs);
      writeFileSync(candidatePath, originalCandidates);
      if (invalid === "source") {
        const source = JSON.parse(originalCandidates);
        source.candidates[0].line += 1;
        writeFileSync(candidatePath, JSON.stringify(source));
      } else if (invalid === "input") {
        legacyOutputs = { ...legacyOutputs, "refresh-review-input": { ...refreshReviewInput.outputRequired({ stepOutputs: legacyOutputs }), sha256: "0".repeat(64) } };
      } else if (invalid === "revalidation") {
        legacyOutputs = { ...legacyOutputs, "record-revalidation": { skipped: true } };
      } else {
        const projection = { ...legacyOutputs[scanCandidates.id] as Record<string, unknown>,
          ...invalid === "provenance" ? { artifactPath: join(first.runDirPath, "other-run.json") } : { head: "0".repeat(40) },
        };
        legacyOutputs = { ...legacyOutputs, [scanCandidates.id]: projection };
      }
      persistLegacyOutputs();
      database.resumeRun(runId, new Date().toISOString());
      coordinator.refill();
      await coordinator.whenIdle();
      expect(database.getRun(runId)?.state, invalid).toBe("needs_attention");
      expect(database.listPendingPublications().filter((entry) => entry.runId === runId)).toEqual([]);
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewed).toEqual({});
    }
    writeFileSync(candidatePath, originalCandidates);
    legacyOutputs = originalOutputs;
    persistLegacyOutputs();
    database.resumeRun(runId, new Date().toISOString());
    coordinator.refill();
    await coordinator.whenIdle();
    expect(database.getRun(runId)).toMatchObject({ state: "succeeded", executionCompletedAt: receipt });
    const after = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
    expect(after.reviewed[path]).toEqual({ digest: input.contentDigests[path], surfaces: ["secret-handling"] });
    expect(after.pending[0]?.finding).toMatchObject(finding);
    expect(readFileSync(join(first.runDirPath, "security-review-revalidation.json"), "utf8")).toContain("Independent reproduction");
  } finally {
    await runtime.stop();
    await coordinator.dispose();
    database.close();
    unregisterHarness();
  }
});
