import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkExplorationRationale,
  EXPLORATION_RATIONALE_FILENAME,
  listStrategicBlockedAlternatives,
  type StrategicBlockedSummary,
  validateExplorationRationale,
} from "./exploration-rationale.js";

function task(
  state: "blocked" | "backlog" | "ready",
  id: string,
  attrs: { title?: string; priority?: string; area?: string; summary?: string; body?: string } = {},
): string {
  const updatedAt = "2026-04-01T00:00:00.000Z";
  return [
    "---",
    `id: ${id}`,
    `title: ${attrs.title ?? id}`,
    `status: ${state}`,
    `priority: ${attrs.priority ?? "p1"}`,
    `area: ${attrs.area ?? "architecture"}`,
    `summary: ${attrs.summary ?? `${id} summary`}`,
    `created_at: ${updatedAt}`,
    `updated_at: ${updatedAt}`,
    "---",
    "",
    "## Problem",
    "Body.",
    "",
    "## Desired Outcome",
    "Outcome.",
    "",
    "## Constraints",
    "Constraints.",
    "",
    "## Done When",
    "- when",
    "",
    attrs.body ?? "",
  ].join("\n");
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "exploration-rationale-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  return dir;
}

describe("listStrategicBlockedAlternatives", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    // tmpdir cleanup is best-effort; tests get fresh dirs anyway
  });

  it("returns strategic-area blocked tasks with parsed precondition kinds", () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-arch-block.md"),
      task("blocked", "task-arch-block", {
        priority: "p1",
        area: "architecture",
        title: "Distribute KotaClient namespace types and daemon-side wire",
        body: "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve?\n",
      }),
    );
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-research-block.md"),
      task("blocked", "task-research-block", {
        priority: "p3",
        area: "research",
        title: "Read upstream paper",
        body: "## Unblock Precondition\n\nkind: capability-installed\ncapability: web-fetch\n",
      }),
    );

    const result = listStrategicBlockedAlternatives(projectDir);
    expect(result.map((r) => r.id)).toEqual(["task-arch-block"]);
    expect(result[0].preconditionKind).toBe("owner-decision");
    expect(result[0].priority).toBe("p1");
    expect(result[0].movable).toBe(false);
  });

  it("marks owner-decision blocks as movable when a resolved marker is present", () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-arch-resolved.md"),
      task("blocked", "task-arch-resolved", {
        priority: "p1",
        area: "architecture",
        title: "Distribute KotaClient namespace types and daemon-side wire",
        body:
          "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve?\n\n" +
          "<!-- blocked-promoter-resolved: slot=arch resolved_at=2026-05-08T05:00:00.000Z -->\n",
      }),
    );

    const result = listStrategicBlockedAlternatives(projectDir);
    expect(result).toHaveLength(1);
    expect(result[0].movable).toBe(true);
  });

  it("excludes blocked tasks that classify as fan-out via title surface markers", () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-arch-fanout.md"),
      task("blocked", "task-arch-fanout", {
        priority: "p1",
        area: "architecture",
        title: "Surface project selection in operator clients for multi-project supervision",
        body: "## Unblock Precondition\n\nkind: owner-decision\nslot: pick\nquestion: Approve?\n",
      }),
    );

    expect(listStrategicBlockedAlternatives(projectDir)).toEqual([]);
  });

  it("skips blocked tasks without a parseable precondition", () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-broken.md"),
      task("blocked", "task-broken", {
        priority: "p1",
        area: "architecture",
        body: "## Problem\n\nNo precondition section.\n",
      }),
    );

    expect(listStrategicBlockedAlternatives(projectDir)).toEqual([]);
  });
});

describe("validateExplorationRationale", () => {
  const baseOptions = {
    blockedTaskIds: new Set<string>(["task-existing-block", "task-other-block"]),
    strategicAlternatives: [] as readonly StrategicBlockedSummary[],
    actionableCount: 0,
    strategicReadyCoverageGap: false,
  };

  it("accepts a noop rationale with empty considered list", () => {
    const result = validateExplorationRationale(
      {
        decision: "noop",
        summary: "Queue is healthy and no external watchlist signal changed.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      },
      baseOptions,
    );
    expect(result.decision).toBe("noop");
  });

  it("accepts a watchlist-only rationale", () => {
    const result = validateExplorationRationale(
      {
        decision: "watchlist-only",
        summary: "Snapshotted three watchlist URLs, none worth a new task.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      },
      baseOptions,
    );
    expect(result.decision).toBe("watchlist-only");
  });

  it("accepts watchlist-only when ready work already has strategic coverage", () => {
    const result = validateExplorationRationale(
      {
        decision: "watchlist-only",
        summary: "Refreshed a watchlist entry while a p1 ready task kept the queue healthy.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      },
      { ...baseOptions, actionableCount: 1, strategicReadyCoverageGap: false },
    );
    expect(result.decision).toBe("watchlist-only");
  });

  it("rejects unknown decision values", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "explore-everything",
          summary: "Made some changes.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: [],
        },
        baseOptions,
      ),
    ).toThrow(/decision must be one of/);
  });

  it("rejects watchlist-only when the inspect step found a strategic-ready gap", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "watchlist-only",
          summary: "Refreshed a watchlist entry but left the p3-only ready queue unchanged.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: [],
        },
        { ...baseOptions, actionableCount: 1, strategicReadyCoverageGap: true },
      ),
    ).toThrow(/strategicReadyCoverageGap is true/);
  });

  it("rejects noop when the inspect step found a strategic-ready gap", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "noop",
          summary: "No external signal changed, but the ready queue was still p3-only.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: [],
        },
        { ...baseOptions, actionableCount: 1, strategicReadyCoverageGap: true },
      ),
    ).toThrow(/strategicReadyCoverageGap is true/);
  });

  it("rejects task ids on queue-unchanged decisions", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "watchlist-only",
          summary: "Claimed a watchlist-only decision while also touching a task.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: ["task-new-work"],
        },
        baseOptions,
      ),
    ).toThrow(/must leave taskIdsTouched empty/);
  });

  it("rejects too-short summaries", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "noop",
          summary: "ok",
          blockedAlternativesConsidered: [],
          taskIdsTouched: [],
        },
        baseOptions,
      ),
    ).toThrow(/substantive sentence/);
  });

  it("rejects considered entries that cite non-existent blocked task ids", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "create-task",
          summary: "Opened a new architecture task.",
          blockedAlternativesConsidered: [
            { id: "task-fictional", reasonNotChosen: "Owner approval not yet given." },
          ],
          taskIdsTouched: ["task-new-architecture"],
        },
        baseOptions,
      ),
    ).toThrow(/not present in data\/tasks\/blocked/);
  });

  it("requires create-task decisions to consider every strategic alternative", () => {
    const strategicAlt: StrategicBlockedSummary = {
      id: "task-existing-block",
      title: "Existing block",
      priority: "p1",
      area: "architecture",
      preconditionKind: "owner-decision",
      ageDays: 5,
      movable: false,
    };
    expect(() =>
      validateExplorationRationale(
        {
          decision: "create-task",
          summary: "Opened a new architecture task without considering alternatives.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: ["task-new-architecture"],
        },
        { ...baseOptions, strategicAlternatives: [strategicAlt] },
      ),
    ).toThrow(/must consider every strategic-area blocked task/);
  });

  it("accepts create-task decisions that name every strategic alternative", () => {
    const strategicAlt: StrategicBlockedSummary = {
      id: "task-existing-block",
      title: "Existing block",
      priority: "p1",
      area: "architecture",
      preconditionKind: "owner-decision",
      ageDays: 5,
      movable: false,
    };
    const result = validateExplorationRationale(
      {
        decision: "create-task",
        summary: "New strategic task addresses a different concern from the open block.",
        blockedAlternativesConsidered: [
          {
            id: "task-existing-block",
            reasonNotChosen: "Owner approval still pending; cannot promote.",
          },
        ],
        taskIdsTouched: ["task-new-architecture"],
      },
      { ...baseOptions, strategicAlternatives: [strategicAlt] },
    );
    expect(result.blockedAlternativesConsidered).toHaveLength(1);
  });

  it("accepts noop when no strategic alternative is currently movable", () => {
    const blockedAlt: StrategicBlockedSummary = {
      id: "task-existing-block",
      title: "Owner-decision still open",
      priority: "p1",
      area: "architecture",
      preconditionKind: "owner-decision",
      ageDays: 7,
      movable: false,
    };
    const result = validateExplorationRationale(
      {
        decision: "noop",
        summary: "Every strategic blocked task is gated on owner approval; queue is paused.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      },
      { ...baseOptions, strategicAlternatives: [blockedAlt] },
    );
    expect(result.decision).toBe("noop");
  });

  it("rejects noop when a movable strategic alternative is uncited and actionableCount=0", () => {
    const movableAlt: StrategicBlockedSummary = {
      id: "task-existing-block",
      title: "Owner approved this morning",
      priority: "p1",
      area: "architecture",
      preconditionKind: "owner-decision",
      ageDays: 3,
      movable: true,
    };
    expect(() =>
      validateExplorationRationale(
        {
          decision: "noop",
          summary: "Queue looked quiet so I left things alone without checking the unblocked task.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: [],
        },
        { ...baseOptions, strategicAlternatives: [movableAlt] },
      ),
    ).toThrow(/cannot leave a movable strategic-area blocked alternative uncited/);
  });

  it("accepts noop when every movable strategic alternative is cited with a reasonNotChosen", () => {
    const movableAlt: StrategicBlockedSummary = {
      id: "task-existing-block",
      title: "Owner approved but rescoping pending",
      priority: "p1",
      area: "architecture",
      preconditionKind: "owner-decision",
      ageDays: 3,
      movable: true,
    };
    const result = validateExplorationRationale(
      {
        decision: "noop",
        summary: "Owner-approved task is movable but needs operator-driven rescoping before promotion.",
        blockedAlternativesConsidered: [
          {
            id: "task-existing-block",
            reasonNotChosen:
              "Owner approval landed but the task scope no longer matches reality; flagged for rescoping in attention digest.",
          },
        ],
        taskIdsTouched: [],
      },
      { ...baseOptions, strategicAlternatives: [movableAlt] },
    );
    expect(result.decision).toBe("noop");
  });

  it("accepts noop when actionableCount > 0 even with a movable strategic alternative present", () => {
    const movableAlt: StrategicBlockedSummary = {
      id: "task-existing-block",
      title: "Owner approved but builder is busy",
      priority: "p1",
      area: "architecture",
      preconditionKind: "owner-decision",
      ageDays: 3,
      movable: true,
    };
    const result = validateExplorationRationale(
      {
        decision: "noop",
        summary: "Builder is already working a ready task; explorer leaves the movable alternative for the next idle window.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      },
      { ...baseOptions, strategicAlternatives: [movableAlt], actionableCount: 1 },
    );
    expect(result.decision).toBe("noop");
  });

  it("requires promote/decompose to name affected task ids", () => {
    expect(() =>
      validateExplorationRationale(
        {
          decision: "promote",
          summary: "Promoted a blocked task.",
          blockedAlternativesConsidered: [],
          taskIdsTouched: [],
        },
        baseOptions,
      ),
    ).toThrow(/requires taskIdsTouched/);
  });
});

describe("checkExplorationRationale", () => {
  let projectDir: string;
  let runDir: string;
  const queueContext = { actionableCount: 0, strategicReadyCoverageGap: false };

  beforeEach(() => {
    projectDir = makeProjectDir();
    runDir = mkdtempSync(join(tmpdir(), "exploration-rationale-run-"));
  });

  it("throws when the rationale file is missing", () => {
    expect(() => checkExplorationRationale(projectDir, runDir, queueContext)).toThrow(
      /Missing/,
    );
  });

  it("throws when the rationale file is not valid JSON", () => {
    writeFileSync(join(runDir, EXPLORATION_RATIONALE_FILENAME), "not json");
    expect(() => checkExplorationRationale(projectDir, runDir, queueContext)).toThrow(
      /not valid JSON/,
    );
  });

  it("returns the parsed rationale when the artifact passes validation", () => {
    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Queue is healthy; nothing changed externally.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );
    const rationale = checkExplorationRationale(projectDir, runDir, queueContext);
    expect(rationale.decision).toBe("noop");
  });

  it("rejects a noop rationale when a movable strategic alternative is on disk and uncited", () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-arch-resolved.md"),
      task("blocked", "task-arch-resolved", {
        priority: "p1",
        area: "architecture",
        title: "Distribute KotaClient namespace types and daemon-side wire",
        body:
          "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve?\n\n" +
          "<!-- blocked-promoter-resolved: slot=arch resolved_at=2026-05-08T05:00:00.000Z -->\n",
      }),
    );
    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Queue looked quiet so I left things alone without addressing the resolved block.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );
    expect(() => checkExplorationRationale(projectDir, runDir, queueContext)).toThrow(
      /movable strategic-area blocked alternative uncited/,
    );
  });

  it("accepts a noop rationale when the only strategic alternative is non-movable", () => {
    writeFileSync(
      join(projectDir, "data", "tasks", "blocked", "task-arch-pending.md"),
      task("blocked", "task-arch-pending", {
        priority: "p1",
        area: "architecture",
        title: "Distribute KotaClient namespace types and daemon-side wire",
        body: "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve?\n",
      }),
    );
    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Every strategic blocked task is gated on owner approval; queue is legitimately paused.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );
    const rationale = checkExplorationRationale(projectDir, runDir, queueContext);
    expect(rationale.decision).toBe("noop");
  });
});
