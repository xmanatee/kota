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
  dependsOn?: string[];
}): string {
  return [
    "---",
    "status: open",
    "priority: p2",
    ...(args.dependsOn ? [`depends_on: [${args.dependsOn.join(", ")}]`] : []),
    "---",
    "",
    `# ${args.id}`,
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

  it("keeps the pinned outcome comparison in default input when raw semantic references overflow", () => {
    const workspaceRoot = makeProgressReviewScopeRoot("progress-compact-comparison");
    scopeRoots.push(workspaceRoot);
    const baseline = {
      id: "before", workflow: "builder", status: "failed", delivery: null,
      startedAt: "2026-05-01T00:00:00.000Z", completedAt: "2026-05-01T01:00:00.000Z",
      errors: ["critic-rejection"], observationOnly: false,
    };
    const evidence = collectProgressReviewEvidence({
      workspaceRoot, scopeRoot: workspaceRoot, stateDir: join(workspaceRoot, ".kota"),
      trigger: { event: progressReviewRequested.name, schemaRef: null, payload: {} }, now: NOW,
      semanticInput: {
        automatic: true, shouldReview: true, inputRevision: 1, deliveryAttempt: 0,
        boundary: "evidence-window", reason: "Delivery recovered after an intervention",
        evidenceRefs: Array.from({ length: 12 }, (_, i) => `.kota/runs/run-${i}/metadata.json`),
        evidenceWindow: {
          fromHead: "a".repeat(40), toHead: "b".repeat(40),
          startedAt: baseline.startedAt, endedAt: NOW.toISOString(),
          baseline: [baseline], current: [{ ...baseline, id: "after", status: "success", errors: [], delivery: "delivered" }],
          excluded: ["one unavailable run"],
        },
      },
    });
    const compact = compactProgressReviewEvidenceForAgent(evidence);
    const comparison = compact.evidence.find((entry) => entry.id === "state:systemic-window");
    expect(comparison).toEqual(evidence.evidence.find((entry) => entry.id === "state:systemic-window"));
    expect(comparison?.summary).toContain("Historical baseline: builder/failed/delivery=unavailable/errors=critic-rejection: 1");
    expect(comparison?.summary).toContain("New or revised outcomes: builder/success/delivery=delivered/errors=none: 1");
    expect(comparison?.summary).toContain("one unavailable run");
    expect(comparison?.summary).toContain(baseline.startedAt);
    expect(comparison?.path).toBe("progress-review-evidence.json");
    expect(compact.evidence.length).toBeLessThan(evidence.evidence.length);
    expect(compact.semanticInput.evidenceWindow).toBeUndefined();
    expect(compact.excluded.some((entry) => entry.includes("omitted"))).toBe(true);
  });

  it("keeps the complete open queue while the compact agent packet points to canonical refs", () => {
    const workspaceRoot = makeProgressReviewScopeRoot("progress-canonical-queue");
    scopeRoots.push(workspaceRoot);
    for (let index = 0; index < 25; index += 1) {
      const id = `task-open-${String(index).padStart(2, "0")}`;
      writeFileSync(
        join(workspaceRoot, "data", "tasks", `${id}.md`),
        task({
          id,
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
    expect(evidence.tasks.filter((item) => item.state === "open"))
      .toHaveLength(25);
    expect(evidence.tasks.find((item) => item.taskId === "task-open-00"))
      .toMatchObject({ dependsOn: [], waitingOn: [] });
    expect(evidence.tasks.find((item) => item.taskId === "task-open-01"))
      .toMatchObject({
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
