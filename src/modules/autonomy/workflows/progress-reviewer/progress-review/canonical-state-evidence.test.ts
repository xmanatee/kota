import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { progressReviewRequested } from "../events.js";
import {
  makeProgressReviewScopeRoot,
  NOW,
} from "../workflow.test-helpers.js";
import { compactProgressReviewEvidenceForAgent } from "./agent-packet.js";
import { collectProgressReviewEvidence } from "./collect.js";

function task(args: {
  id: string;
  anchor?: boolean;
  dependsOn?: string[];
}): string {
  return [
    "---",
    `id: ${args.id}`,
    `title: ${args.id}`,
    "status: backlog",
    "priority: p2",
    "area: autonomy",
    `summary: ${args.id} summary`,
    `created_at: ${NOW.toISOString()}`,
    `updated_at: ${NOW.toISOString()}`,
    ...(args.anchor ? ["anchor: true"] : []),
    ...(args.dependsOn ? [`depends_on: [${args.dependsOn.join(", ")}]`] : []),
    "---",
    "",
    "## Problem",
    "",
    "Canonical queue fixture.",
    "",
  ].join("\n");
}

describe("progress-reviewer canonical state evidence", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("keeps the complete open queue while the compact agent packet points to canonical refs", () => {
    const workspaceRoot = makeProgressReviewScopeRoot("progress-canonical-queue");
    scopeRoots.push(workspaceRoot);
    for (let index = 0; index < 25; index += 1) {
      const id = `task-open-${String(index).padStart(2, "0")}`;
      writeFileSync(
        join(workspaceRoot, "data", "tasks", "backlog", `${id}.md`),
        task({
          id,
          anchor: index === 0,
          dependsOn: index === 1 ? ["task-open-00"] : undefined,
        }),
      );
    }

    const evidence = collectProgressReviewEvidence({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"),
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { reason: "inspect canonical queue" },
      },
      now: NOW,
    });
    expect(evidence.tasks.filter((item) => item.state === "backlog"))
      .toHaveLength(25);
    expect(evidence.tasks.find((item) => item.taskId === "task-open-00"))
      .toMatchObject({ anchor: true, dependsOn: [], waitingOn: [] });
    expect(evidence.tasks.find((item) => item.taskId === "task-open-01"))
      .toMatchObject({
        anchor: false,
        dependsOn: ["task-open-00"],
        waitingOn: ["task-open-00"],
      });
    expect(evidence.excluded.some((entry) => entry.includes("open queue")))
      .toBe(false);

    const compact = compactProgressReviewEvidenceForAgent(evidence);
    expect(compact.evidence.filter((item) => item.kind === "task")).toHaveLength(20);
    expect(compact.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "state:queue",
        kind: "state",
        path: "data/tasks/",
      }),
      expect.objectContaining({ id: "state:autonomy-issues", kind: "state" }),
      expect.objectContaining({ id: "state:recovery", kind: "state" }),
      expect.objectContaining({ id: "state:owner-decisions", kind: "state" }),
    ]));
  });
});
