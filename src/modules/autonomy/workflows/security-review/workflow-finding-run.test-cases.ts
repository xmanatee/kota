import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import dispatcher from "../dispatcher/workflow.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import publication from "../security-finding-publication/workflow.js";
import { createSecurityFindingTasksInWorker } from "./blocking-operations.js";
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

    it("preserves scan and finding identities through domain finalization and publication while redacting diagnostics", async () => {
      const path = "src/modules/token-store.ts";
      fixture.writeProjectFile(path, "const value = process.env.API_KEY;\nwriteFileSync(taskPath, body);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const { verdict: _verdict, rationale: _rationale, ...finding } = fixture.confirmedFindingForClaim("Task writes lack authority");
      finding.candidateId = `secret-handling:${path}:1`;
      finding.affectedPath = path;
      finding.evidence = [{ path, line: 2, excerpt: "writeFileSync(taskPath, body);" }];
      finding.id = "standalone-instance-lock-credential-disclosure";
      finding.violatedInvariant = "runtime-credentials-must-not-enter-agent-context";
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
      expect(after.pending[0]?.finding).toMatchObject(finding);
      const metadata = JSON.parse(readFileSync(join(result.runDirPath, "metadata.json"), "utf8"));
      expect(metadata.steps.find((step: { id: string }) => step.id === "investigate-candidates").output.findings[0]).toMatchObject({
        id: "[redacted]", violatedInvariant: "[redacted]",
      });
      const input = JSON.parse(readFileSync(join(result.runDirPath, "security-review-input.json"), "utf8"));
      expect(after.reviewed[path]).toMatchObject({ digest: input.contentDigests[path], surfaces: expect.arrayContaining(["secret-handling", "task-workflow-mutation"]) });
      expect(after.pending[0]?.finding.candidateId).toBe(finding.candidateId);
      const diagnostics = metadata.steps.find((step: { id: string }) => step.id === "describe-candidates").output;
      expect(diagnostics.candidates).toContainEqual(expect.objectContaining({ surface: "[redacted]" }));
      expect(diagnostics.contentDigests).toBeUndefined();
      const scan = JSON.parse(readFileSync(join(result.runDirPath, "security-review-scan-input.json"), "utf8"));
      expect(scan.candidates).toContainEqual(expect.objectContaining({ path, surface: "secret-handling" }));
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

    it.each(["superseded", "missing", "invalid-lineage"] as const)("parks %s pending identity without blocking an independent confirmed finding", async (failure) => {
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      const taskId = "task-stale";
      if (failure !== "missing") fixture.writeLegacySecurityFindingTask({
        id: taskId, state: "done", runId: "historical", claim: "Historical repair",
        ...(failure === "superseded" ? { supersededBy: "task-canonical" } : {}),
      });
      const taskPath = join(fixture.workspaceRoot, `data/tasks/archive/${taskId}.md`);
      const contract = failure === "missing" ? null : readFileSync(taskPath, "utf8");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const stale = { runId: "older-review", finding: {
        ...fixture.confirmedFindingForClaim("Unresolved old nomination"), existingTaskId: taskId,
        evidenceLineage: failure === "invalid-lineage" ? { kind: "unchanged" as const, reference: "missing-evidence", rationale: "Stale reference" } : null,
      } };
      state.compareAndSet(SECURITY_REVIEW_STATE_KEY, state.read(SECURITY_REVIEW_STATE_KEY).revision, {
        ...decodeSecurityReviewState(null), pending: [stale],
      });
      const finding = { ...fixture.confirmedFindingForClaim("Independent confirmed exploit"),
        id: "independent", candidateId: `reported-boundary:${path}:1`, productionOwner: "core/network", violatedInvariant: "egress-authority",
      };
      const result = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { evidence: { id: "independent", paths: [path], critical: true, reason: "New exploit" } } },
        stepOutputs: {
          "investigate-candidates": { findings: [(({ verdict: _verdict, rationale: _rationale, ...input }) => input)(finding)], coverage: [{ path, disposition: "reviewed", rationale: "Examined the independent boundary" }, ...(failure === "missing" ? [] : [{ path: `data/tasks/archive/${taskId}.md`, disposition: "reviewed", rationale: "Inspected historical task" }])] },
          "revalidate-findings": { findings: [{ id: finding.id, verdict: "confirmed", rationale: "Independent exploit reproduced" }], summary: "New supported finding" },
        },
      }).run();
      expect(result.status, result.error).toBe("success");
      const pending = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending;
      expect(pending).toHaveLength(2);
      expect(pending[0]).toEqual(stale);
      expect(pending[1]?.finding.id).toBe("independent");
      expect(JSON.parse(readFileSync(join(result.runDirPath, "security-review-outcome.json"), "utf8")).parkedFindings).toEqual([
        { runId: stale.runId, findingId: stale.finding.id, reason: expect.any(String) },
      ]);
      const published = createSecurityFindingTasksInWorker({ workspaceRoot: fixture.workspaceRoot, runId: pending[1]!.runId, findings: [pending[1]!.finding] });
      expect(published.createdTaskIds).toHaveLength(1);
      if (contract !== null) expect(readFileSync(taskPath, "utf8")).toBe(contract);
    });

    it("deduplicates nominated synonymous evidence before outbox publication while retaining a new variant", async () => {
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.writeLegacySecurityFindingTask({ id: "task-database", state: "open", runId: "original", claim: "Database confidentiality" });
      fixture.commitProjectState();
      const taskPath = join(fixture.workspaceRoot, "data/tasks/task-database.md");
      const contract = readFileSync(taskPath, "utf8");
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const first = { ...fixture.confirmedFindingForClaim("Database bypass"), existingTaskId: "task-database", candidateId: `reported-boundary:${path}:1` };
      const run = (finding: typeof first, requestId: string) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { evidence: { id: requestId, paths: [path], critical: true, reason: "Revalidate the reported database precondition" } } },
        stepOutputs: {
          "investigate-candidates": { findings: [(( { verdict: _verdict, rationale: _rationale, ...input }) => input)(finding)], coverage: [{ path, disposition: "reviewed", rationale: "Inspected the reported authority crossing" }, ...requestId === "first" ? [{ path: "data/tasks/task-database.md", disposition: "reviewed", rationale: "Inspected existing repair contract" }] : []] },
          "revalidate-findings": { findings: [{ id: finding.id, verdict: "confirmed", rationale: "The nominated task owns the same invariant and repair" }], summary: "Supported evidence" },
        },
      }).run();
      const initial = await run(first, "first");
      expect(initial.status, initial.error).toBe("success");
      const originalPending = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending;
      expect(originalPending).toHaveLength(1);
      const synonym = { ...first, productionOwner: "src/core/native-sandbox", violatedInvariant: "database-confidentiality", evidence: [{ path, line: 42, excerpt: "A wider excerpt of the same bypass" }] };
      expect((await run(synonym, "revalidation")).status).toBe("success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toEqual(originalPending);
      expect((await run({ ...synonym, evidenceIdentity: "new-journal-variant" }, "new-variant")).status).toBe("success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending).toHaveLength(2);
      expect(readFileSync(taskPath, "utf8")).toBe(contract);
    });

    it.each(["unchanged", "new-variant"] as const)("reconciles %s lineage into every matching legacy pending finding before publication", async (kind) => {
      const taskId = "task-legacy";
      fixture.writeLegacySecurityFindingTask({ id: taskId, state: "done", runId: "original", claim: "Resolved database bypass", findingId: "historical-bypass" });
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.commitProjectState();
      const taskPath = join(fixture.workspaceRoot, `data/tasks/archive/${taskId}.md`);
      const contract = readFileSync(taskPath, "utf8");
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const original = { ...fixture.confirmedFindingForClaim("Pending database bypass"), existingTaskId: taskId, candidateId: `reported-boundary:${path}:1` };
      const { unavailable: _unavailable, recovery: _recovery, ...initial } = decodeSecurityReviewState(null);
      const legacyPending = [original, { ...original, id: "synonymous-pending", productionOwner: "core/native-sandbox", violatedInvariant: "database-confidentiality", evidence: [{ path, line: 99, excerpt: "Retained second excerpt" }] }]
        .map(({ evidenceLineage: _lineage, ...finding }, index) => ({ runId: `legacy-review-${index}`, finding }));
      state.compareAndSet(SECURITY_REVIEW_STATE_KEY, state.read(SECURITY_REVIEW_STATE_KEY).revision, { ...initial, version: 1, pending: legacyPending });
      expect(() => createSecurityFindingTasksInWorker({ workspaceRoot: fixture.workspaceRoot, runId: "unvalidated", findings: [original] })).toThrow("requires revalidated evidence lineage");
      const lineage = { kind, reference: "historical-bypass", rationale: "Independently checked the historical exploit and its repair" };
      const revalidated = { ...original, id: "fresh-revalidation", productionOwner: "core/database-authority", violatedInvariant: "database-read-isolation", evidenceLineage: lineage };
      const distinct = { ...original, id: "distinct-exploit", existingTaskId: null, violatedInvariant: "network-egress", evidenceIdentity: "distinct-egress-v1" };
      const findings = [revalidated, distinct];
      const runId = `revalidate-legacy-${kind}`;
      const result = await new WorkflowScenarioDriver(workflow, {
        runId, workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.requested", payload: { evidence: { id: "revalidate-legacy", paths: [path], critical: true, reason: "Resolve retained evidence lineage" } } },
        stepOutputs: {
          "investigate-candidates": { findings: findings.map(({ verdict: _verdict, rationale: _rationale, ...finding }) => finding), coverage: [{ path, disposition: "reviewed", rationale: "Examined the reported boundary" }, { path: `data/tasks/archive/${taskId}.md`, disposition: "reviewed", rationale: "Checked historical evidence" }] },
          "revalidate-findings": { findings: findings.map((finding) => ({ id: finding.id, verdict: "confirmed", rationale: "Checked exploit and common repair independently" })), summary: "Lineage and distinct exploit confirmed" },
        },
      }).run();
      expect(result.status, result.error).toBe("success");
      const pending = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).pending;
      expect(pending).toHaveLength(3);
      expect(pending.slice(0, 2)).toEqual(legacyPending.map((entry) => ({ ...entry, finding: { ...entry.finding, evidenceLineage: lineage } })));
      expect(readFileSync(taskPath, "utf8")).toBe(contract);
      expect(JSON.parse(readFileSync(join(result.runDirPath, "security-review-outcome.json"), "utf8")).lineageReconciliations).toEqual(legacyPending.map((entry) => ({
        pendingRunId: entry.runId, pendingFindingId: entry.finding.id, revalidationRunId: runId,
        evidenceKey: resolveSecurityFindingTaskTarget(fixture.workspaceRoot, revalidated).evidenceKey,
      })));
      expect(JSON.parse(readFileSync(join(result.runDirPath, "security-review-outcome.json"), "utf8")).parkedFindings).toEqual([]);
      // Exercise the publication owner's real materializer with the retained
      // outbox. Process supervision and resource admission have separate owners.
      const published = pending.map((entry) => createSecurityFindingTasksInWorker({ workspaceRoot: fixture.workspaceRoot, runId: entry.runId, findings: [entry.finding] }));
      expect(published.flatMap((entry) => entry.createdTaskIds)).toHaveLength(1);
      expect(published.flatMap((entry) => entry.updatedTaskIds)).toEqual(kind === "unchanged" ? [] : [taskId]);
      if (kind === "unchanged") expect(readFileSync(taskPath, "utf8")).toBe(contract);
      else {
        const reopened = readFileSync(join(fixture.workspaceRoot, `data/tasks/${taskId}.md`), "utf8");
        expect(reopened).toContain("Resolved database bypass");
        expect(reopened).toContain("legacy-review-0");
        expect(reopened).toContain(`Evidence lineage (${kind}): historical-bypass`);
      }
    });

    it("parks unchanged unavailable coverage and resumes only relevant evidence without losing failed attempts", async () => {
      const prerequisite = "clients/mobile/build.json";
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.writeProjectFile(prerequisite, '{"nativeBridge":false}');
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const evidence = { id: "mobile-report", paths: [path], critical: false, reason: "Mobile authorization requires a native bridge" };
      const unavailable = { path, disposition: "unavailable", rationale: "Native bridge unavailable; recheck on build configuration or explicit capability report", prerequisitePaths: [prerequisite] };
      const run = (payload: Record<string, unknown>, coverage: unknown[], fail = false) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand,
          runAgent: async () => { if (fail) throw new Error("provider unavailable"); return { findings: [], coverage }; },
        }, trigger: { event: payload.evidence ? "autonomy.security-review.requested" : "autonomy.security-review.due", payload },
      }).run();
      const due = async () => inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0 },
        await collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot, stateDir: state.stateDir, runCommand: runGitEvidenceCommand, reviewState: decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value) }));
      expect((await run({ evidence }, [unavailable])).status).toBe("success");
      const held = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(held.reviewed[path]).toBeUndefined();
      expect(held.unavailable[path]?.rationale).toContain("Native bridge unavailable");
      expect(held.evidenceRequests).toHaveLength(1);
      expect((await due()).due).toBe(false);
      expect((await run({ evidence }, [])).steps["investigate-candidates"].status).toBe("skipped");

      const other = "src/other.ts";
      fixture.writeProjectFile(other, "fetch(url);\n");
      fixture.commitProjectState();
      expect((await due()).changedSurfaces.flatMap((surface) => surface.paths)).not.toContain(path);
      expect((await run({}, [{ path: other, disposition: "reviewed", rationale: "Inspected destination policy" }])).status).toBe("success");
      expect((await due()).due).toBe(false);

      fixture.writeProjectFile(prerequisite, '{"nativeBridge":true}');
      fixture.commitProjectState();
      expect((await due()).due).toBe(true);
      const beforeFailure = state.read(SECURITY_REVIEW_STATE_KEY).value;
      expect((await run({}, [], true)).status).toBe("failed");
      expect(state.read(SECURITY_REVIEW_STATE_KEY).value).toEqual(beforeFailure);
      expect((await due()).due).toBe(true);
      expect((await run({}, [unavailable])).status).toBe("success");
      expect((await due()).due).toBe(false);

      const newEvidence = { ...evidence, id: "bridge-now-available", critical: true };
      expect((await run({ evidence: newEvidence }, [{ path, disposition: "unreviewed", rationale: "Caller still needs investigation" }])).status).toBe("success");
      expect((await due()).due).toBe(true);
      expect((await run({}, [unavailable])).status).toBe("success");
      fixture.writeProjectFile(path, "writeFileSync(otherTask, body);\n");
      fixture.commitProjectState();
      expect((await due()).due).toBe(true);
      expect((await run({}, [{ path, disposition: "reviewed", rationale: "Inspected changed caller and destination" }])).status).toBe("success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).unavailable[path]).toBeUndefined();
    });

    it("settles unavailable requests individually without cycling or suppressing unseen reports", async () => {
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const request = (id: string) => ({ id, paths: [path], critical: false, reason: `Independent report ${id}` });
      const run = (payload: Record<string, unknown>) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => ({ findings: [], coverage: [{ path, disposition: "unavailable", prerequisitePaths: [], rationale: "External native bridge remains unavailable" }] }) },
        trigger: { event: "autonomy.security-review.requested", payload },
      }).run();
      expect((await run({ evidence: request("first") })).status).toBe("success");
      const snapshot = state.read(SECURITY_REVIEW_STATE_KEY);
      const pending = decodeSecurityReviewState(snapshot.value);
      pending.evidenceRequests.push({ request: request("second"), reviewed: {} }, { request: request("third"), reviewed: {} });
      state.compareAndSet(SECURITY_REVIEW_STATE_KEY, snapshot.revision, pending);
      const second = await run({});
      expect(second.status, second.error).toBe("success");
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value).unavailable[path]?.requestIds).toEqual(["first", "second"]);
      const third = await run({});
      expect(third.status, third.error).toBe("success");
      const held = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(held.unavailable[path]?.requestIds).toEqual(["first", "second", "third"]);
      expect(held.evidenceRequests).toHaveLength(3);
      expect(held.reviewedEvidenceIds).toEqual([]);
      expect((await run({})).steps["investigate-candidates"].status).toBe("skipped");
      const git = await collectSecurityReviewGitEvidence({ workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot, stateDir: state.stateDir, runCommand: runGitEvidenceCommand, reviewState: held });
      expect(inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0 }, git).due).toBe(false);
    });

    it("keeps completed partial-request coverage from readmitting another request's unavailable path", async () => {
      const other = "src/modules/other.ts";
      fixture.writeProjectFile(path, "writeFileSync(taskPath, body);\n");
      fixture.writeProjectFile(other, "writeFileSync(otherTask, body);\n");
      fixture.commitProjectState();
      const state = createTestTransactionalRunState(join(fixture.workspaceRoot, ".kota/state"));
      const first = { id: "partial", paths: [path, other], critical: false, reason: "Inspect both authority boundaries" };
      const second = { id: "later", paths: [path], critical: false, reason: "Inspect an external native precondition" };
      const unavailable = (path: string) => ({ path, disposition: "unavailable", prerequisitePaths: [], rationale: "External native bridge remains unavailable" });
      const reviewed = { path, disposition: "reviewed", rationale: "Inspected caller authority and destination" };
      const run = (payload: Record<string, unknown>, coverage: unknown[]) => new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot,
        ports: { state, runCommand: runGitEvidenceCommand, runAgent: async () => ({ findings: [], coverage }) },
        trigger: { event: payload.evidence ? "autonomy.security-review.requested" : "autonomy.security-review.due", payload },
      }).run();
      const evidence = () => collectSecurityReviewGitEvidence({
        workspaceRoot: fixture.workspaceRoot, scopeRoot: fixture.workspaceRoot, stateDir: state.stateDir,
        runCommand: runGitEvidenceCommand, reviewState: decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value),
      });
      const initial = await run({ evidence: first }, [reviewed, unavailable(other)]);
      expect(initial.status, initial.error).toBe("success");
      const later = await run({ evidence: second }, [unavailable(path)]);
      expect(later.status, later.error).toBe("success");
      const held = decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value);
      expect(held.evidenceRequests.find(({ request }) => request.id === first.id)?.reviewed[path]).toBe(held.reviewed[path]?.digest);
      expect(held.unavailable[path]?.requestIds).toEqual([second.id]);
      const git = await evidence();
      expect(git.pendingEvidence).toBe(false);
      expect(inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0 }, git).due).toBe(false);
      for (const payload of [{}, { evidence: first }, { evidence: second }]) {
        const replay = await run(payload, []);
        expect(replay.status, replay.error).toBe("success");
        expect(replay.steps["investigate-candidates"].status).toBe("skipped");
      }

      const fresh = await run({ evidence: { ...second, id: "new-precondition" } }, [unavailable(path)]);
      expect(fresh.status, fresh.error).toBe("success");
      expect(fresh.steps["investigate-candidates"].status).toBe("success");
      fixture.writeProjectFile(path, "writeFileSync(changedTask, body);\n");
      fixture.commitProjectState();
      const changed = await evidence();
      expect(changed.pendingEvidence).toBe(true);
      expect(inspectSecurityReviewDue(fixture.workspaceRoot, { stateDir: state.stateDir, cooldownMs: 0 }, changed).due).toBe(true);
      const resumed = await run({}, [reviewed]);
      expect(resumed.status, resumed.error).toBe("success");
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
      expect(reviewed.steps["describe-candidates"].output).toMatchObject({
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
        expect(reviewed.steps["describe-candidates"].output).toMatchObject({
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
      expect(failed.steps["describe-candidates"].output).toMatchObject({ candidates: [{ path: paths[0] }, { path: paths[35] }] });
      expect(decodeSecurityReviewState(state.read(SECURITY_REVIEW_STATE_KEY).value)).toEqual(partial);
      fixture.writeProjectFile(paths[1]!, "export const mayRead = () => false;\n");
      fixture.commitProjectState("change an already covered request path");
      const resumed = await new WorkflowScenarioDriver(workflow, {
        workspaceRoot: fixture.workspaceRoot, ports: { state, runCommand: runGitEvidenceCommand },
        trigger: { event: "autonomy.security-review.due", payload: {} },
        stepOutputs: { "investigate-candidates": { findings: [], coverage: [paths[0], paths[1], paths[35]].map((path) => ({ path, disposition: "reviewed", rationale: "Inspected remaining gate and changed content" })) } },
      }).run();
      expect(resumed.status, resumed.error).toBe("success");
      expect(resumed.steps["describe-candidates"].output).toMatchObject({ candidates: [{ path: paths[0] }, { path: paths[1] }, { path: paths[35] }] });
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
      expect(retry.steps["describe-candidates"].output).toMatchObject({ candidateCount: 2 });
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
      expect(retry.steps["describe-candidates"].output).toMatchObject({ candidates: [{ path, surface: "auth-approval-boundary" }] });
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
      expect(retry.steps["describe-candidates"].output).toMatchObject({ candidates: [{ path, matcher: "explicit-evidence" }] });
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
