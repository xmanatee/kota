import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { createOrUpdateSecurityFindingTasks } from "./security-review.js";
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
  });
}
