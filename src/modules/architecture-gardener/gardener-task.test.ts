import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { listFullRepoTasks, moveTaskById } from "#modules/repo-tasks/repo-tasks-domain.js";
import { decodeGardenerDecision } from "./decision.js";
import { stageGardenerTask } from "./gardener-task.js";

it("materializes an unverified two-consumer proposal and leaves existing task ownership intact", () => {
  const root = mkdtempSync(join(tmpdir(), "gardener-proposal-"));
  try {
    const decision = decodeGardenerDecision({ revisit: { reason: "Revisit when the observed boundary changes", deliveryIssueKeys: [] },
      action: "propose", rationale: "Two maintained readers share anchored I/O but retain distinct decoders.",
      evidenceRefs: ["src/modules/a/read.ts:readRecord", "src/modules/b/read.ts:readRecord"], existingTaskId: null,
      proposal: { priority: "p2",
        mechanismKey: "record-read", title: "Share anchored record reads", problem: "Two readers maintain the same security boundary.",
        expectedOutcome: "One anchored I/O owner with domain-owned decoders.", consumers: ["a/read.ts", "b/read.ts"],
        alternatives: ["Keep distinct decoders; extract I/O instead of a universal store."],
        migrationAndRetirement: "Migrate both callers and remove their duplicated I/O helpers.",
        preservationEvidenceNeeded: "Both owners reject linked records and retain their domain shapes.",
        simplificationEvidenceNeeded: "Inspect both migrated callers and retired boundaries.",
        abstraction: { commonBehavior: "Descriptor-anchored reads", variationPoint: "Domain decoder", canonicalOwner: "core record I/O" },
      },
    });
    const first = stageGardenerTask({ heldTaskIds: [], workspaceRoot: root, runId: "first", decision });
    expect(first.touchedTaskQueue).toBe(true);
    expect(stageGardenerTask({ heldTaskIds: [], workspaceRoot: root, runId: "replay", decision }).disposition).toBe("unchanged");
    const task = listFullRepoTasks(root)[0]!;
    expect(task.body).toContain("unverified expectation");
    expect(task.body).toContain("a/read.ts");
    expect(task.body).toContain("b/read.ts");
    const second = stageGardenerTask({ heldTaskIds: [], workspaceRoot: root, runId: "second", decision: {
      ...decision, proposal: { ...decision.proposal!, expectedOutcome: "Revised suggestion cannot overwrite an owned task." },
    } });
    expect(second.taskId).toBe(first.taskId);
    expect(second.touchedTaskQueue).toBe(false);
    expect(listFullRepoTasks(root)).toEqual([task]);
    expect(second.disposition).toBe("deferred");
    moveTaskById(root, task.id, "done");
    const held = stageGardenerTask({ workspaceRoot: root, runId: "held", decision, heldTaskIds: [task.id] });
    expect(held.disposition).toBe("deferred");
    expect(listFullRepoTasks(root)[0]!.state).toBe("done");
    const reopened = stageGardenerTask({ workspaceRoot: root, runId: "reopened", decision, heldTaskIds: [] });
    expect(reopened).toMatchObject({ taskId: task.id, touchedTaskQueue: true, disposition: "applied" });
    expect(reopened.actions).toContainEqual(expect.objectContaining({ kind: "reopened-task", taskId: task.id }));
    expect(listFullRepoTasks(root)[0]).toMatchObject({ state: "open", priority: "p2" });
    expect(() => stageGardenerTask({ heldTaskIds: [], workspaceRoot: root, runId: "missing", decision: { revisit: { reason: "Revisit when the observed boundary changes", deliveryIssueKeys: [] },
      action: "covered", existingTaskId: "missing", proposal: null, rationale: "Already covered", evidenceRefs: ["missing"],
    } })).toThrow("missing task");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
