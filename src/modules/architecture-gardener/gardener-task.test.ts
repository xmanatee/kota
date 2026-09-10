import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { decodeGardenerDecision } from "./decision.js";
import { stageGardenerTask } from "./gardener-task.js";

it("materializes an unverified two-consumer proposal and leaves existing task ownership intact", () => {
  const root = mkdtempSync(join(tmpdir(), "gardener-proposal-"));
  try {
    const decision = decodeGardenerDecision({
      action: "propose", rationale: "Two maintained readers share anchored I/O but retain distinct decoders.",
      evidenceRefs: ["src/modules/a/read.ts:readRecord", "src/modules/b/read.ts:readRecord"], revisit: { reason: "Revisit changed source ownership or linked delivery outcomes.", deliveryIssueKeys: [] }, existingTaskId: null,
      proposal: {
        priority: "p1", mechanismKey: "record-read", title: "Share anchored record reads", problem: "Two readers maintain the same security boundary.",
        expectedOutcome: "One anchored I/O owner with domain-owned decoders.", consumers: ["a/read.ts", "b/read.ts"],
        alternatives: ["Keep distinct decoders; extract I/O instead of a universal store."],
        migrationAndRetirement: "Migrate both callers and remove their duplicated I/O helpers.",
        preservationEvidenceNeeded: "Both owners reject linked records and retain their domain shapes.",
        simplificationEvidenceNeeded: "Inspect both migrated callers and retired boundaries.",
        abstraction: { commonBehavior: "Descriptor-anchored reads", variationPoint: "Domain decoder", canonicalOwner: "core record I/O" },
      },
    });
    const first = stageGardenerTask({ workspaceRoot: root, runId: "first", decision });
    expect(first.touchedTaskQueue).toBe(true);
    const task = listFullRepoTasks(root)[0]!;
    expect(task.body).toContain("unverified expectation");
    expect(task.body).toContain("a/read.ts");
    expect(task.body).toContain("b/read.ts");
    expect(stageGardenerTask({ workspaceRoot: root, runId: "replay", decision }).disposition).toBe("unchanged");
    const second = stageGardenerTask({ workspaceRoot: root, runId: "second", decision: {
      ...decision, proposal: { ...decision.proposal!, expectedOutcome: "Revised suggestion cannot overwrite an owned task." },
    } });
    expect(second.taskId).toBe(first.taskId);
    expect(second.touchedTaskQueue).toBe(false);
    expect(second.disposition).toBe("deferred");
    expect(listFullRepoTasks(root)).toEqual([task]);
    expect(() => stageGardenerTask({ workspaceRoot: root, runId: "missing", decision: {
      action: "covered", revisit: { reason: "Inspect missing work.", deliveryIssueKeys: [] }, existingTaskId: "missing", proposal: null, rationale: "Already covered", evidenceRefs: ["missing"],
    } })).toThrow("missing task");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
