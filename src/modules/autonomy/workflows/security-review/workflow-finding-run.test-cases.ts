import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import dispatcher from "../dispatcher/workflow.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import publication from "../security-finding-publication/workflow.js";
import { collectSecurityReviewGitEvidence, inspectSecurityReviewDue } from "./due-check.js";
import { securityFindingPublicationRequested } from "./events.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY } from "./review-state.js";
import { resolveSecurityFindingTaskTarget } from "./security-review-task-identity.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

export function describeSecurityReviewFindingRunTests(workflow: WorkflowDefinitionInput): void {
  describe("security review durable outcomes", () => {
    let fixture: SecurityReviewProjectFixture;
    beforeEach(() => { fixture = new SecurityReviewProjectFixture(); });
    afterEach(() => fixture.cleanup());
    const path = "src/modules/example.ts";

    it("publishes confirmed evidence through the task writer and keeps rejected findings in the review", async () => {
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const { verdict: _verdict, rationale: _rationale, ...finding } = fixture.confirmedFindingForClaim("Task writes lack authority");
      finding.candidateId = `task-workflow-mutation:${path}:1`;
      const investigation = { coverage: [{ path, disposition: "reviewed", rationale: "Inspected writer entry point and callers" }], findings: [finding, { ...finding, id: "rejected", evidenceIdentity: "hypothetical" }] };
      const result = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { runCommand: runGitEvidenceCommand, state }, trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepOutputs: {
          "investigate-candidates": investigation,
          "revalidate-findings": { findings: [{ id: finding.id, verdict: "confirmed", rationale: "Caller controls task body at the mutation boundary" }, { id: "rejected", verdict: "rejected", rationale: "No second reachable sink" }], summary: "One supported variant" },
        },
      }).run();
      expect(result.status, result.error).toBe("success");
      const after = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(after.pending).toHaveLength(1);
      expect(after.reviewed[path]).toBeTruthy();
      expect(readFileSync(join(result.runDirPath, "security-review-revalidation.json"), "utf8")).toContain("No second reachable sink");
      const taskId = resolveSecurityFindingTaskTarget(fixture.workspaceRoot, after.pending[0]!.finding).id;
      const published = await new WorkflowScenarioDriver(publication, {
        workspaceRoot: fixture.workspaceRoot, ports: { runCommand: runGitEvidenceCommand, state },
        trigger: { event: securityFindingPublicationRequested.name, payload: { taskId } },
      }).run();
      expect(published.status, published.error).toBe("success");
      expect(readFileSync(join(fixture.workspaceRoot, `data/tasks/${taskId}.md`), "utf8")).toContain("Task writes lack authority");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual([]);
    });

    it("reviews explicit evidence without scanner matches and admits new evidence on unchanged content once", async () => {
      const path = "src/service/gate.ts";
      fixture.writeProjectFile(path, "export const mayRead = () => true;\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      let agentCalls = 0;
      const run = (payload: Record<string, unknown>) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot,
        ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => {
          agentCalls += 1;
          return { findings: [], coverage: [{ path, disposition: "reviewed", rationale: "Inspected caller authority and fixed destination policy" }] };
        } }, trigger: { event: "autonomy.security-review.requested", payload },
      }).run();
      expect((await run({})).steps["investigate-candidates"].status).toBe("skipped");
      const initial = { evidence: { id: "reported-precondition", paths: [path], critical: false, reason: "Caller can reach this boundary" } };
      const reviewed = await run(initial);
      expect(reviewed.status, reviewed.error).toBe("success");
      expect(reviewed.steps["scan-candidates"].output).toMatchObject({
        candidates: [{ path, matcher: "explicit-evidence" }], candidateCount: 1,
      });
      expect((await run(initial)).steps["investigate-candidates"].status).toBe("skipped");
      const signal = { evidence: { id: "new-critical-precondition", paths: [path], critical: true, reason: "New deployment exposes the caller boundary" } };
      expect((await run(signal)).status).toBe("success");
      expect((await run(signal)).steps["investigate-candidates"].status).toBe("skipped");
      expect(agentCalls).toBe(2);
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewedEvidenceIds).toEqual([
        "reported-precondition", "new-critical-precondition",
      ]);
    });

    it("retains completed reported boundaries across keyword-free edits, deletion and recreation", async () => {
      const path = "src/service/gate.ts";
      fixture.writeProjectFile(path, "export const mayRead = () => false;\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const evidence = { id: "reported-gate", paths: [path], critical: false, reason: "Caller authorization gate" };
      const run = (payload: Record<string, unknown>, fail = false) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot,
        ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => {
          if (fail) throw new Error("Provider unavailable");
          return { findings: [], coverage: [{ path, disposition: "reviewed", rationale: "Inspected caller authority at the current boundary" }] };
        } }, trigger: { event: payload.evidence ? "autonomy.security-review.requested" : "autonomy.security-review.due", payload },
      }).run();
      const due = async () => inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0 },
        await collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot,
          stateDir: state.stateDir, runCommand: runGitEvidenceCommand,
          reviewState: decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value) }));
      expect((await run({ evidence })).status).toBe("success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).evidenceRequests).toEqual([]);
      expect((await due()).due).toBe(false);
      expect((await run({ evidence })).steps["investigate-candidates"].status).toBe("skipped");

      for (const change of ["edit", "delete", "recreate"]) {
        if (change === "delete") rmSync(join(fixture.workspaceRoot, path));
        else fixture.writeProjectFile(path, "export const mayRead = () => true;\n");
        fixture.commitProjectState(change);
        expect(await due()).toMatchObject({ due: true, changedSurfaces: [{ surface: "reported-boundary", paths: [path] }] });
        const before = state.read(SECURITY_REVIEW_STATE_KEY);
        expect((await run({}, true)).status).toBe("failed");
        expect(state.read(SECURITY_REVIEW_STATE_KEY)).toEqual(before);
        expect((await due()).due).toBe(true);
        // A consumed report may be replayed, but the changed content must still be reviewed.
        const reviewed = await run(change === "edit" ? { evidence } : {});
        expect(reviewed.status, reviewed.error).toBe("success");
        expect(reviewed.steps["scan-candidates"].output).toMatchObject({
          candidateCount: 1, candidates: [{ path, surface: "reported-boundary", matcher: "changed-boundary" }],
        });
        expect((await due()).due).toBe(false);
        expect((await run({ evidence })).steps["investigate-candidates"].status).toBe("skipped");
      }
    });

    it("advances capped evidence while retaining deleted unchecked paths through failed continuation", async () => {
      const paths = Array.from({ length: 36 }, (_, index) => `src/service/gate-${String(index).padStart(2, "0")}.ts`);
      for (const path of paths) fixture.writeProjectFile(path, "export const mayRead = () => true;\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const evidence = { id: "many-reported-boundaries", paths, critical: true, reason: "Caller can bypass these independent gates" };
      const first = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { evidence } },
        stepOutputs: { "investigate-candidates": { findings: [], coverage: paths.slice(0, 35).map((path, index) => ({
          path, disposition: index === 0 ? "unreviewed" : "reviewed", rationale: "Inspected caller boundary; first gate still needs investigation",
        })) } },
      }).run();
      expect(first.status, first.error).toBe("success");
      const partial = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(partial.reviewedEvidenceIds).toEqual([]);
      expect(Object.keys(partial.evidenceRequests[0]!.reviewed)).toEqual(paths.slice(1, 35));
      for (const path of [paths[0]!, paths[35]!]) {
        expect(partial.reviewed[path]).toBeUndefined();
        rmSync(join(fixture.workspaceRoot, path));
      }
      fixture.commitProjectState("delete unreviewed and capped request paths");
      const evidenceAt = () => collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot,
        scopeRoot: fixture.workspaceRoot, stateDir: state.stateDir, reviewState: decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value), runCommand: runGitEvidenceCommand });
      // Dispatcher can continue explicit evidence even though routine batching is cooling down.
      expect(inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir }, await evidenceAt()).due).toBe(true);
      const failed = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error("Provider unavailable"); } },
        trigger: { event: "autonomy.security-review.due", payload: {} },
      }).run();
      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("Provider unavailable");
      expect(failed.steps["scan-candidates"].output).toMatchObject({ candidates: [{ path: paths[0] }, { path: paths[35] }] });
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value)).toEqual(partial);
      fixture.writeProjectFile(paths[1]!, "export const mayRead = () => false;\n");
      fixture.commitProjectState("change an already covered request path");
      const resumed = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.due", payload: {} },
        stepOutputs: { "investigate-candidates": { findings: [], coverage: [paths[0], paths[1], paths[35]].map((path) => ({ path, disposition: "reviewed", rationale: "Inspected remaining gate and changed content" })) } },
      }).run();
      expect(resumed.status, resumed.error).toBe("success");
      expect(resumed.steps["scan-candidates"].output).toMatchObject({ candidates: [{ path: paths[0] }, { path: paths[1] }, { path: paths[35] }] });
      const complete = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(complete.evidenceRequests).toEqual([]);
      expect(complete.reviewedEvidenceIds).toEqual([evidence.id]);
      for (const path of [paths[0]!, paths[35]!]) {
        expect(complete.reviewed[path]).toEqual({ digest: "deleted", surfaces: ["reported-boundary"] });
      }
      expect(inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir }, await evidenceAt()).due).toBe(false);
      const replay = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { evidence } },
      }).run();
      expect(replay.status, replay.error).toBe("success");
      expect(replay.steps["investigate-candidates"].status).toBe("skipped");
    });

    it("refreshes the examined head, digest and candidates on a runtime retry", async () => {
      fixture.writeProjectFile(path, "await fetch(url);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const failedRunId = "security-review-failed-investigation";
      const failed = await new WorkflowScenarioDriver(workflow, {
        runId: failedRunId, workspaceRoot: fixture.workspaceRoot,
        ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error("Provider unavailable"); } },
        trigger: { event: "autonomy.security-review.requested", payload: {} },
      }).run();
      expect(failed.status).toBe("failed");
      const other = "src/service/other.ts";
      fixture.writeProjectFile(path, "export const mayRead = () => true;\n");
      fixture.writeProjectFile(other, "export const mayRead = (user) => user.permission === 'read';\n");
      fixture.commitProjectState("new head before runtime retry");
      const retry = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { retryOf: failedRunId } },
        stepOutputs: { "investigate-candidates": { findings: [], coverage: [path, other].map((path) => ({ path, disposition: "reviewed", rationale: "Inspected current caller authority and transport" })) } },
      }).run();
      expect(retry.status, retry.error).toBe("success");
      const input = JSON.parse(readFileSync(join(retry.runDirPath, "security-review-input.json"), "utf8"));
      const oldInput = JSON.parse(readFileSync(join(failed.runDirPath, "security-review-input.json"), "utf8"));
      expect(input.currentHead.sha).not.toBe(oldInput.currentHead.sha);
      expect(input.contentDigests[path]).not.toBe(oldInput.contentDigests[path]);
      expect(retry.steps["scan-candidates"].output).toMatchObject({ candidateCount: 2 });
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewed).toMatchObject({
        [path]: { digest: input.contentDigests[path] }, [other]: { digest: input.contentDigests[other] },
      });
    });

    it.each(["failed", "unchecked"])("keeps routine %s evidence eligible after its first scanner signal disappears", async (outcome) => {
      const path = "src/service/gate.ts";
      fixture.writeProjectFile(path, "export const mayRead = (user) => user.permission === 'read';\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const dispatch = () => new WorkflowScenarioDriver(dispatcher, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
      }).run();
      const admitted = await dispatch();
      expect(admitted.status, admitted.error).toBe("success");
      const trigger = admitted.emitted.find((entry) => entry.event === "autonomy.security-review.due");
      expect(trigger).toBeDefined();
      const first = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => {
          if (outcome === "failed") throw new Error("Provider unavailable");
          return { findings: [], coverage: [{ path, disposition: "unreviewed", rationale: "Caller requires further investigation" }] };
        } }, trigger: trigger!,
      }).run();
      expect(first.status).toBe(outcome === "failed" ? "failed" : "success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewed[path]).toBeUndefined();
      if (outcome === "failed") rmSync(join(fixture.workspaceRoot, path));
      else fixture.writeProjectFile(path, "export const mayRead = () => true;\n");
      fixture.commitProjectState("remove first unreviewed permission check");
      const git = await collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot,
        stateDir: state.stateDir, runCommand: runGitEvidenceCommand, reviewState: decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value) });
      expect(inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0 }, git).due).toBe(true);
      const retry = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.due", payload: {} },
        stepOutputs: { "investigate-candidates": { findings: [], coverage: [{ path, disposition: "reviewed", rationale: "Inspected removed check and callers" }] } },
      }).run();
      expect(retry.status, retry.error).toBe("success");
      expect(retry.steps["scan-candidates"].output).toMatchObject({ candidates: [{ path, surface: "auth-approval-boundary" }] });
    });

    it.each([false, true])("pins a new deleted explicit path, including critical=%s and failed first-review retries", async (critical) => {
      const path = "src/service/gate.ts";
      fixture.writeProjectFile(path, "export const mayRead = () => false;\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const evidence = { id: "new-deleted-gate", paths: [path], critical, reason: "A caller gate has been removed" };
      // The ordinary report arrives after deletion. The critical report first fails
      // while the path exists, then retries from retained runtime input after deletion.
      if (!critical) {
        rmSync(join(fixture.workspaceRoot, path));
        fixture.commitProjectState("delete before first explicit report");
      }
      const failedRunId = "failed-first-explicit-review";
      const failed = await new WorkflowScenarioDriver(workflow, {
        runId: failedRunId, workspaceRoot: fixture.workspaceRoot,
        ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => { throw new Error("Provider unavailable"); } },
        trigger: { event: "autonomy.security-review.requested", payload: { evidence } },
      }).run();
      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("Provider unavailable");
      expect(state.read(SECURITY_REVIEW_STATE_KEY).value).toBeNull();
      if (critical) {
        rmSync(join(fixture.workspaceRoot, path));
        fixture.commitProjectState("delete after first failed explicit report");
      }
      const retry = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { retryOf: failedRunId } },
        stepOutputs: { "investigate-candidates": { findings: [], coverage: [{ path, disposition: "reviewed", rationale: "Inspected deleted gate and remaining callers" }] } },
      }).run();
      expect(retry.status, retry.error).toBe("success");
      expect(retry.steps["scan-candidates"].output).toMatchObject({ candidates: [{ path, matcher: "explicit-evidence" }], contentDigests: { [path]: "deleted" } });
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewedEvidenceIds).toEqual([evidence.id]);
    });

    it("retains the entire evidence input when independent revalidation omits a finding", async () => {
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const { verdict: _verdict, rationale: _rationale, ...finding } = fixture.confirmedFindingForClaim("Task write bypass");
      finding.candidateId = `task-workflow-mutation:${path}:1`;
      const result = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { runCommand: runGitEvidenceCommand, state }, trigger: { event: "autonomy.security-review.requested", payload: {} },
        stepOutputs: {
          "investigate-candidates": { coverage: [{ path, disposition: "reviewed", rationale: "Examined task write" }], findings: [finding] },
          "revalidate-findings": { findings: [], summary: "Omitted verdict" },
        },
      }).run();
      expect(result.status).toBe("failed");
      expect(result.error).toContain("omitted investigation finding");
      expect(state.read(SECURITY_REVIEW_STATE_KEY).value).toBeNull();
      expect(readFileSync(join(result.runDirPath, "security-review-investigation.json"), "utf8")).toContain(finding.id);
    });

    it("consumes only reviewed paths and leaves changed heads and failed reviews eligible", async () => {
      const other = "src/modules/example-other.ts";
      fixture.writeProjectFile(path, "await fetch(url);\n");
      fixture.writeProjectFile(other, "await fetch(otherUrl);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const run = (fail: boolean) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { runCommand: runGitEvidenceCommand, state, runAgent: async () => {
          if (fail) throw new Error("Provider unavailable");
          return { findings: [], coverage: [{ path, disposition: "reviewed", rationale: "Transport validates caller URLs" }, { path: other, disposition: "unreviewed", rationale: "Caller boundary remains unexamined" }] };
        } }, trigger: { event: "autonomy.security-review.due", payload: { changedPaths: ["stale-hint.ts"] } },
      }).run();
      const failed = await run(true);
      expect(failed.status).toBe("failed");
      expect(state.read(SECURITY_REVIEW_STATE_KEY).value).toBeNull();
      const succeeded = await run(false);
      expect(succeeded.status, succeeded.error).toBe("success");
      const reviewed = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(reviewed.reviewed[path]).toBeTruthy();
      expect(reviewed.reviewed[other]).toBeUndefined();
      fixture.writeProjectFile(path, "await fetch(changedUrl);\n");
      fixture.writeProjectFile(other, "export const mayRead = () => true;\n");
      fixture.commitProjectState("change reviewed content and erase an unchecked scanner signal");
      const retry = await run(false);
      expect(retry.status, retry.error).toBe("success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).reviewed[path]?.digest).not.toBe(reviewed.reviewed[path]?.digest);
    });
  });
}
