import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { decodeSecurityReviewState } from "./review-state.js";
import { createOrUpdateSecurityFindingTasks } from "./security-review.js";
import { resolvePendingSecurityFindings, resolveSecurityFindingTaskTarget, securityFindingFamilyKey } from "./security-review-task-identity.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

export function describeSecurityReviewTaskIdentityTests(): void {
  describe("security repair families", () => {
    let fixture: SecurityReviewProjectFixture;
    beforeEach(() => { fixture = new SecurityReviewProjectFixture(); });
    afterEach(() => fixture.cleanup());

    it("coalesces common-owner variants, ignores unchanged evidence, and preserves distinct invariants", () => {
      const first = fixture.confirmedFindingForClaim("Credential reads bypass authority");
      const second = { ...first, id: "database", evidenceIdentity: "database-sidecars-v1", exploitPreconditions: "Candidate can read the daemon database sidecar", evidence: [{ path: "src/core/workflow/database.ts", line: 9, excerpt: "readFileSync(sidecar)" }] };
      const result = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "review-one", findings: [first, second] });
      expect(result.createdTaskIds).toHaveLength(1);
      expect(result.updatedTaskIds).toEqual([]);
      const path = result.taskPaths[0]!;
      const original = readFileSync(path, "utf8");
      expect(original).toContain(first.exploitPreconditions);
      expect(original).toContain(second.exploitPreconditions);
      const replay = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, {
        runId: "review-two", findings: [{ ...first, id: "renamed", candidateId: "line-moved", claim: "New wording", evidence: first.evidence.map((entry) => ({ ...entry, path: "src/core/workflow/moved.ts", line: 999 })) }],
      });
      expect(replay.unchangedFindingIds).toEqual(["renamed"]);
      expect(readFileSync(path, "utf8")).toBe(original);
      const distinct = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "review-three", findings: [{ ...first, violatedInvariant: "network-egress", evidenceIdentity: "new-exploit" }] });
      expect(distinct.createdTaskIds).toHaveLength(1);
      expect(distinct.createdTaskIds).not.toEqual(result.createdTaskIds);
    });

    it("anchors synonymous reviews and excerpt changes to the nominated task, retaining new variants", () => {
      const first = fixture.confirmedFindingForClaim("Database reads bypass confinement");
      const result = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "first", findings: [first] });
      const id = result.createdTaskIds[0]!;
      const before = readFileSync(result.taskPaths[0]!, "utf8");
      const synonym = { ...first, existingTaskId: id, productionOwner: "src/core/native-sandbox", violatedInvariant: "database-confidentiality",
        evidence: [{ path: "src/core/native-sandbox.ts", line: 99, excerpt: "A differently bounded excerpt of the same early return" }],
      };
      expect(resolveSecurityFindingTaskTarget(fixture.workspaceRoot, synonym).key).toBe(resolveSecurityFindingTaskTarget(fixture.workspaceRoot, first).key);
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "repeated", findings: [synonym] }).unchangedFindingIds).toEqual([first.id]);
      expect(readFileSync(result.taskPaths[0]!, "utf8")).toBe(before);
      const variant = { ...synonym, evidenceIdentity: "late-journal-v2", exploitPreconditions: "Journal appears after child launch",
        evidenceLineage: { kind: "new-variant" as const, reference: resolveSecurityFindingTaskTarget(fixture.workspaceRoot, first).evidenceKey, rationale: "The same denial owner must cover late journals too" },
      };
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "new-variant", findings: [variant] }).updatedTaskIds).toEqual([id]);
      expect(readFileSync(result.taskPaths[0]!, "utf8")).toContain(variant.exploitPreconditions);
      expect(readFileSync(result.taskPaths[0]!, "utf8")).toContain(first.exploitPreconditions);
    });

    it("reconciles the historical two-entry outbox through one stable materializer target", () => {
      fixture.writeLegacySecurityFindingTask({ id: "task-database", state: "open", runId: "original", claim: "Database read confinement" });
      const first = { ...fixture.confirmedFindingForClaim("Non-writer database read"), existingTaskId: "task-database", productionOwner: "core/agent-harness/native-cli-sandbox", violatedInvariant: "daemon-database-read-isolation", evidenceIdentity: "native-nonwriter-database-read" };
      const second = { ...first, productionOwner: "src/core/agent-harness/native-cli-sandbox", violatedInvariant: "nonwriter-daemon-database-confidentiality", evidence: [{ path: first.affectedPath, line: 21, excerpt: "Another excerpt boundary for unchanged evidence" }] };
      const { unavailable: _unavailable, recovery: _recovery, ...initial } = decodeSecurityReviewState(null);
      const pending = [first, second].map(({ evidenceLineage: _lineage, ...finding }, index) => ({ runId: `observed-${index}`, finding }));
      const migrated = decodeSecurityReviewState({ ...initial, version: 1, pending });
      expect(migrated.pending.map((entry) => entry.runId)).toEqual(["observed-0", "observed-1"]);
      const targets = migrated.pending.map((entry) => resolveSecurityFindingTaskTarget(fixture.workspaceRoot, entry.finding));
      expect(targets[0]!.evidenceKey).toBe(targets[1]!.evidenceKey);
      const results = migrated.pending.map((entry) => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: entry.runId, findings: [entry.finding] }));
      expect(results[0]!.updatedTaskIds).toEqual(["task-database"]);
      expect(results[1]!.unchangedFindingIds).toEqual([second.id]);
      expect(results.flatMap((result) => result.createdTaskIds)).toEqual([]);
      expect(readFileSync(results[0]!.taskPaths[0]!, "utf8")).toContain("Database read confinement");
    });

    it("validates historical evidence lineage without reopening unchanged completed work", () => {
      fixture.writeLegacySecurityFindingTask({ id: "task-legacy", state: "done", runId: "original", claim: "Known database bypass", findingId: "native-nonwriter-database-read" });
      const finding = { ...fixture.confirmedFindingForClaim("Synonymous database bypass"), existingTaskId: "task-legacy",
        evidenceLineage: { kind: "unchanged" as const, reference: "native-nonwriter-database-read", rationale: "Original run already demonstrates this precondition" },
      };
      const path = join(fixture.workspaceRoot, "data/tasks/archive/task-legacy.md");
      const before = readFileSync(path, "utf8");
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "missing-lineage", findings: [{ ...finding, evidenceLineage: null }] })).toThrow("requires revalidated evidence lineage");
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "repeat", findings: [finding] }).unchangedFindingIds).toEqual([finding.id]);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "bad-reference", findings: [{ ...finding, evidenceLineage: { ...finding.evidenceLineage, reference: "fabricated" } }] })).toThrow("lineage must reference");
      const regression = { ...finding, evidenceIdentity: "regression-after-fix", evidenceLineage: { ...finding.evidenceLineage, kind: "regression" as const } };
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "regression", findings: [regression] }).updatedTaskIds).toEqual(["task-legacy"]);
      moveTaskById(fixture.workspaceRoot, "task-legacy", "done");
      const completedAgain = readFileSync(path, "utf8");
      expect(completedAgain).toContain(before.split("---")[2]!.trim());
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "historical-replay", findings: [{ ...finding, evidenceLineage: null }] })).toThrow("requires revalidated evidence lineage");
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "referenced-replay", findings: [finding] }).unchangedFindingIds).toEqual([finding.id]);
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "regression-replay", findings: [{ ...regression, evidenceLineage: null }] }).unchangedFindingIds).toEqual([regression.id]);
      expect(readFileSync(path, "utf8")).toBe(completedAgain);
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "later-variant", findings: [{ ...regression, evidenceIdentity: "late-journal-variant" }] }).updatedTaskIds).toEqual(["task-legacy"]);
    });

    it("recognizes migrated evidence against the retained legacy record before reopening", () => {
      const original = { ...fixture.confirmedFindingForClaim("Known database bypass"), evidence: [
        { path: "src/core/native-sandbox.ts", line: 12, excerpt: "readFileSync(database);\n\n// ## confinement" },
        { path: "src/core/native-sandbox.ts", line: 20, excerpt: "readFileSync(sidecar);" },
      ] };
      const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
      const family = hash([original.productionOwner, original.violatedInvariant]);
      const evidence = hash([family, original.evidenceIdentity, original.evidence.map((entry) => entry.excerpt.trim()).sort()]);
      const created = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "original", findings: [original] });
      const id = created.createdTaskIds[0]!;
      moveTaskById(fixture.workspaceRoot, id, "done");
      const relativePath = `data/tasks/archive/${id}.md`;
      const path = join(fixture.workspaceRoot, relativePath);
      // Preserve the production evidence rendering; only the identity fields
      // differ between the legacy and current task formats.
      fixture.writeProjectFile(relativePath, readFileSync(path, "utf8")
        .replace(/^security evidence: .+$/m, `security evidence: ${evidence}`)
        .replace(/^evidence identity: .+\n/m, ""));
      const before = readFileSync(path, "utf8");
      const { unavailable: _unavailable, recovery: _recovery, ...initial } = decodeSecurityReviewState(null);
      const { evidenceLineage: _lineage, ...legacyFinding } = original;
      const migrated = decodeSecurityReviewState({ ...initial, version: 1, pending: [{ runId: "legacy-repeat", finding: {
        ...legacyFinding, existingTaskId: id, productionOwner: "src/core/native-sandbox", violatedInvariant: "database-confidentiality",
        evidence: [{ path: original.affectedPath, line: 99, excerpt: "Synonymous review uses another excerpt boundary" }],
      } }] });
      const finding = migrated.pending[0]!.finding;
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "replay", findings: [finding] }).unchangedFindingIds).toEqual([finding.id]);
      expect(readFileSync(path, "utf8")).toBe(before);
      fixture.writeProjectFile(relativePath, before.replace("readFileSync(database);", "unrecoverable historical excerpt"));
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "unverifiable", findings: [finding] })).toThrow("requires revalidated evidence lineage");
      fixture.writeProjectFile(relativePath, before);
      const variant = { ...finding, evidenceIdentity: "new-journal-variant" };
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "renamed-replay", findings: [{ ...finding,
        evidenceLineage: { kind: "regression", reference: evidence, rationale: "The revision has not actually changed" },
      }] })).toThrow("requires a distinct revision");
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "unproven", findings: [variant] })).toThrow("requires revalidated evidence lineage");
      expect(readFileSync(path, "utf8")).toBe(before);
      const result = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "new-variant", findings: [{ ...variant,
        evidenceLineage: { kind: "new-variant", reference: evidence, rationale: "A late journal creates a distinct read path under the same repair owner" },
      }] });
      expect(result.updatedTaskIds).toEqual([id]);
      expect(readFileSync(result.taskPaths[0]!, "utf8")).toContain("readFileSync(database);");
      expect(readFileSync(result.taskPaths[0]!, "utf8")).toContain("readFileSync(sidecar);");
      moveTaskById(fixture.workspaceRoot, id, "done");
      const completedAgain = readFileSync(path, "utf8");
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "historical-replay", findings: [finding] }).unchangedFindingIds).toEqual([finding.id]);
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "variant-replay", findings: [variant] }).unchangedFindingIds).toEqual([variant.id]);
      expect(readFileSync(path, "utf8")).toBe(completedAgain);
      fixture.writeProjectFile(relativePath, completedAgain.replace("readFileSync(database);", "unrecoverable historical excerpt"));
      const unverifiable = readFileSync(path, "utf8");
      expect(() => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "unverifiable-replay", findings: [finding] })).toThrow("requires revalidated evidence lineage");
      expect(readFileSync(path, "utf8")).toBe(unverifiable);
    });

    it("reopens only new evidence and retains completed resolution and proof", () => {
      const finding = fixture.confirmedFindingForClaim("Writer authority bypass");
      const created = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "review-one", findings: [finding] });
      const id = created.createdTaskIds[0]!;
      moveTaskById(fixture.workspaceRoot, id, "done");
      const archive = join(fixture.workspaceRoot, "data/tasks/archive", `${id}.md`);
      const before = readFileSync(archive, "utf8");
      expect(createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "review-two", findings: [finding] }).unchangedFindingIds).toEqual([finding.id]);
      expect(readFileSync(archive, "utf8")).toBe(before);
      const result = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "review-three", findings: [{ ...finding, evidenceIdentity: "non-writer-bypass-v2", exploitPreconditions: "Read-only reviewer has no writer identity" }] });
      expect(result.updatedTaskIds).toEqual([id]);
      const reopened = readFileSync(result.taskPaths[0]!, "utf8");
      expect(reopened).toContain("review-one");
      expect(reopened).toContain("review-three");
      expect(reopened).toContain("Read-only reviewer has no writer identity");
    });

    it("adopts an explicitly reviewed existing repair task without replacing its contract", () => {
      fixture.writeLegacySecurityFindingTask({ id: "task-existing-repair", state: "open", runId: "old-review", claim: "Protect native authority" });
      const finding = { ...fixture.confirmedFindingForClaim("Related database sink"), existingTaskId: "task-existing-repair" };
      const before = readFileSync(join(fixture.workspaceRoot, "data/tasks/task-existing-repair.md"), "utf8");
      const result = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "new-review", findings: [finding] });
      expect(result.updatedTaskIds).toEqual(["task-existing-repair"]);
      expect(readFileSync(result.taskPaths[0]!, "utf8")).toContain(before.split("---")[2]!.trim());
    });

    it("publishes a referenced variant for the same task while retaining evidence that needs lineage", () => {
      fixture.writeLegacySecurityFindingTask({ id: "task-legacy", state: "done", runId: "original", claim: "Known database bypass", findingId: "known-bypass" });
      const stale = { runId: "unresolved-review", finding: { ...fixture.confirmedFindingForClaim("Unresolved historical evidence"), verdict: "confirmed" as const, existingTaskId: "task-legacy" } };
      const variant = { runId: "variant-review", finding: { ...stale.finding, id: "new-variant", evidenceIdentity: "late-journal-v2",
        exploitPreconditions: "Journal appears after child launch",
        evidenceLineage: { kind: "new-variant" as const, reference: "known-bypass", rationale: "The same owner must also deny late journals" },
      } };
      const archive = join(fixture.workspaceRoot, "data/tasks/archive/task-legacy.md");
      const before = readFileSync(archive, "utf8");
      const pending = [stale, variant];
      const { resolved, parked } = resolvePendingSecurityFindings(fixture.workspaceRoot, pending);
      expect(parked).toEqual([{ runId: stale.runId, findingId: stale.finding.id, reason: expect.stringContaining("requires revalidated evidence lineage") }]);
      expect(resolved.map(({ entry }) => entry)).toEqual([variant]);
      expect(readFileSync(archive, "utf8")).toBe(before);
      const results = resolved.map(({ entry }) => createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: entry.runId, findings: [entry.finding] }));
      expect(results[0]!.updatedTaskIds).toEqual(["task-legacy"]);
      const published = readFileSync(results[0]!.taskPaths[0]!, "utf8");
      expect(published).toContain(before.split("---")[2]!.trim());
      expect(published).toContain(variant.finding.exploitPreconditions);
      expect(pending.filter((entry) => !resolved.some((result) => result.entry === entry))).toEqual([stale]);
      expect(resolvePendingSecurityFindings(fixture.workspaceRoot, [stale]).parked).toEqual(parked);
    });

    it("ignores superseded family markers when nominating their canonical replacement but rejects live conflicts", () => {
      fixture.writeLegacySecurityFindingTask({ id: "task-canonical", state: "open", runId: "canonical", claim: "Canonical repair" });
      fixture.writeLegacySecurityFindingTask({ id: "task-superseded", state: "done", runId: "historical", claim: "Previous repair", supersededBy: "task-canonical" });
      const finding = { ...fixture.confirmedFindingForClaim("Same owner and repair"), existingTaskId: "task-canonical" };
      const relativePath = "data/tasks/archive/task-superseded.md";
      const path = join(fixture.workspaceRoot, relativePath);
      fixture.writeProjectFile(relativePath, `${readFileSync(path, "utf8")}\nsecurity family: ${securityFindingFamilyKey(finding)}\n`);
      const before = readFileSync(path, "utf8");
      const result = createOrUpdateSecurityFindingTasks(fixture.workspaceRoot, { runId: "new-review", findings: [finding] });
      expect(result.updatedTaskIds).toEqual(["task-canonical"]);
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(() => resolveSecurityFindingTaskTarget(fixture.workspaceRoot, { ...finding, existingTaskId: "task-superseded" })).toThrow("canonical task");
      fixture.writeLegacySecurityFindingTask({ id: "task-conflict", state: "open", runId: "conflict", claim: "Another canonical repair" });
      const conflictPath = "data/tasks/task-conflict.md";
      fixture.writeProjectFile(conflictPath, `${readFileSync(join(fixture.workspaceRoot, conflictPath), "utf8")}\nsecurity family: ${securityFindingFamilyKey(finding)}\n`);
      expect(() => resolveSecurityFindingTaskTarget(fixture.workspaceRoot, finding)).toThrow("conflicting task nominations");
    });
  });
}
