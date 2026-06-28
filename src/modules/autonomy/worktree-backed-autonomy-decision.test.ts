import { describe, expect, it } from "vitest";
import { WORKTREE_BACKED_AUTONOMY_DECISION } from "./worktree-backed-autonomy-decision.js";

describe("worktree-backed autonomy decision", () => {
  it("records the intended runtime shape in order", () => {
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.runtimeShape.map((phase) => phase.id)).toEqual([
      "claim-task",
      "create-and-lock-worktree",
      "prepare-environment",
      "run-agent",
      "validate-workspace",
      "commit-workspace",
      "merge-through-gate",
      "resolve-bounded-conflicts",
      "rerun-validation",
      "update-state",
      "cleanup",
    ]);
  });

  it("names the local surfaces constrained by the architecture choice", () => {
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.constrainedFiles).toEqual(
      expect.arrayContaining([
        "src/modules/autonomy/workflows/builder/workflow.ts",
        "src/modules/autonomy/workflows/builder/branch-per-task.ts",
        "src/modules/autonomy/workflow-workspace-policy.ts",
        "src/core/workflow/steps/step-executor-agent.ts",
        "src/core/workflow/steps/step-executor-agent-prompt.ts",
        "src/core/workflow/steps/step-executor-agent-run-options.ts",
        "src/modules/autonomy/recovery.ts",
        "src/modules/scheduler/config-slice.ts",
      ]),
    );
  });

  it("keeps the non-negotiable safety rules explicit", () => {
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.safetyRules.map((rule) => rule.id)).toEqual([
      "clean-canonical-checkout",
      "pending-conflicts-stay-visible",
      "untracked-work-preserved",
      "binary-conflicts-never-auto",
      "failed-validation-blocks-merge",
    ]);
  });

  it("captures the staged rollout order before guarded parallelism", () => {
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.rolloutOrder.map((step) => step.name)).toEqual([
      "builder-workspace",
      "status-and-cleanup",
      "mutating-autonomy-workflows",
      "guarded-parallelism",
    ]);
  });

  it("points to the workflow-by-workflow workspace policy", () => {
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.workflowPolicy).toMatchObject({
      source: "src/modules/autonomy/workflow-workspace-policy.ts",
    });
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.workflowPolicy.rule).toContain(
      "workspaceDir plus merge gate",
    );
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.workflowPolicy.rule).toContain(
      "control-state/control-plane",
    );
  });

  it("supersedes the old direct parallel-build rejection with a KOTA-native path", () => {
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.revisitsExternalPattern).toMatchObject({
      pattern: "Multi-Claude parallel builds",
      directAdoption: "rejected",
    });
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.revisitsExternalPattern.revisitPath).toContain(
      "workspaceDir",
    );
    expect(WORKTREE_BACKED_AUTONOMY_DECISION.revisitsExternalPattern.revisitPath).toContain(
      "guarded scheduler parallelism",
    );
  });
});
