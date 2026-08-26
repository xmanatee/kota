import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import { EXPLORATION_RATIONALE_FILENAME } from "./exploration-rationale.js";
import explorerWorkflow from "./workflow.js";

describe("explorer exploration-rationale repair check", () => {
  let projectDir: string;
  let workflowRunDir: string;
  let runDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    projectDir = mkdtempSync(join(tmpdir(), "explorer-rationale-check-"));
    for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
      mkdirSync(join(projectDir, "data", "tasks", state), { recursive: true });
    }
    execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
    workflowRunDir = join(projectDir, ".kota", "runs", "test-run");
    runDir = join(workflowRunDir, "agent-output");
    mkdirSync(runDir, { recursive: true });
  });

  function findExplorationRationaleCheck() {
    const exploreStep = explorerWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "explore" && step.type === "agent",
    );
    if (!exploreStep || !exploreStep.repairLoop) {
      throw new Error("explore agent step or its repairLoop is missing");
    }
    const check = exploreStep.repairLoop.checks.find(
      (entry) => entry.id === "exploration-rationale",
    );
    if (!check || check.type !== "code") {
      throw new Error("exploration-rationale code check not found");
    }
    return check;
  }

  function makeAssessment(
    actionableCount: number,
    overrides: { strategicReadyCoverageGap?: boolean } = {},
  ) {
    const dispatchableCount = actionableCount;
    return {
      counts: {
        backlog: 0,
        ready: actionableCount,
        doing: 0,
        blocked: 1,
        done: 0,
        dropped: 0,
      },
      inboxCount: 0,
      openCount: 1 + actionableCount,
      pullableCount: actionableCount,
      actionableCount,
      promotableBacklogCount: 0,
      dispatchableCount,
      hasDispatchableWork: dispatchableCount > 0,
      dirty: false,
      needsAttention: actionableCount === 0,
      explorationRefreshDue: true,
      strategicReadyCoverageGap: overrides.strategicReadyCoverageGap ?? false,
      strategicBlockedAlternatives: [],
    };
  }

  function makeCtx(
    actionableCount: number,
    overrides: { strategicReadyCoverageGap?: boolean } = {},
  ): WorkflowStepContext {
    return {
      projectDir,
      scopeDir: projectDir,
      workflow: {
        name: "explorer",
        definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
        runId: "test-run",
        runDir: ".kota/runs/test-run",
        runDirPath: workflowRunDir,
      },
      trigger: { event: "autonomy.queue.empty", payload: {} },
      previousOutput: undefined,
      stepOutputs: { "inspect-queue": makeAssessment(actionableCount, overrides) },
      stepResults: {},
      stepOutputList: [],
      runTool: vi.fn(),
      emit: vi.fn(),
      requestRestart: vi.fn(),
      readPrompt: vi.fn(() => ""),
      readRuntimeState: vi.fn(() => ({ workflows: {} })),
      triggerWorkflow: vi.fn(),
    } as unknown as WorkflowStepContext;
  }

  function writeStrategicBlockedAlternative(opts: { resolved: boolean }) {
    const id = "task-strategic-block";
    const resolvedMarker = opts.resolved
      ? "\n<!-- blocked-promoter-resolved: slot=arch resolved_at=2026-05-08T05:00:00.000Z -->\n"
      : "";
    const body =
      "## Problem\n\nA strategic architecture problem.\n\n" +
      "## Unblock Precondition\n\nkind: owner-decision\nslot: arch\nquestion: Approve the new wire?\n" +
      resolvedMarker;
    const file = [
      "---",
      `id: ${id}`,
      "title: Distribute KotaClient namespace types and daemon-side wire",
      "status: blocked",
      "priority: p1",
      "area: architecture",
      "summary: A strategic architecture problem requiring a daemon-side wire.",
      "created_at: 2026-04-01T00:00:00.000Z",
      "updated_at: 2026-04-01T00:00:00.000Z",
      "---",
      "",
      body,
    ].join("\n");
    writeFileSync(join(projectDir, "data", "tasks", "blocked", `${id}.md`), file);
    return { id, body };
  }

  it("accepts a noop rationale when no movable strategic alternative exists", async () => {
    const blocked = writeStrategicBlockedAlternative({ resolved: false });

    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Every strategic blocked alternative is gated on owner approval; queue is paused.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );

    const check = findExplorationRationaleCheck();
    if (check.type !== "code") throw new Error("expected code check");
    const result = await check.run(makeCtx(0), {} as never);
    expect(result).toContain("decision=noop");
    expect(blocked.id).toBe("task-strategic-block");
  });

  it("rejects a noop rationale when a movable strategic alternative is uncited", async () => {
    writeStrategicBlockedAlternative({ resolved: true });

    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "noop",
        summary: "Queue looked quiet so I left things alone without addressing the resolved block.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );

    const check = findExplorationRationaleCheck();
    if (check.type !== "code") throw new Error("expected code check");
    await expect(check.run(makeCtx(0), {} as never)).rejects.toThrow(
      /movable strategic-area blocked alternative uncited/,
    );
  });

  it("rejects queue-unchanged watchlist-only output when inspect found a strategic-ready gap", async () => {
    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "watchlist-only",
        summary: "Refreshed a watchlist entry but left the one-item p3 ready queue unchanged.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );

    const check = findExplorationRationaleCheck();
    if (check.type !== "code") throw new Error("expected code check");
    await expect(
      check.run(makeCtx(1, { strategicReadyCoverageGap: true }), {} as never),
    ).rejects.toThrow(/strategicReadyCoverageGap is true/);
  });

  it("accepts watchlist-only output when inspect reports no strategic-ready gap", async () => {
    writeFileSync(
      join(runDir, EXPLORATION_RATIONALE_FILENAME),
      JSON.stringify({
        decision: "watchlist-only",
        summary: "Refreshed a watchlist entry while the ready queue already had strategic coverage.",
        blockedAlternativesConsidered: [],
        taskIdsTouched: [],
      }),
    );

    const check = findExplorationRationaleCheck();
    if (check.type !== "code") throw new Error("expected code check");
    const result = await check.run(makeCtx(1), {} as never);
    expect(result).toContain("decision=watchlist-only");
  });

});
