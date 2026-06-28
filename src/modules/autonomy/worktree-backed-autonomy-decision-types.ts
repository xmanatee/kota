export type WorktreeBackedAutonomyDecision = {
  id: "worktree-backed-autonomy";
  status: "accepted";
  date: string;
  summary: string;
  sourceRationale: readonly DecisionSource[];
  constrainedFiles: readonly string[];
  localArchitecture: readonly string[];
  runtimeShape: readonly RuntimePhase[];
  safetyRules: readonly SafetyRule[];
  automatedConflictResolution: readonly string[];
  pendingMergePolicy: readonly string[];
  workflowPolicy: {
    source: "src/modules/autonomy/workflow-workspace-policy.ts";
    rule: string;
  };
  rolloutOrder: readonly RolloutStep[];
  revisitsExternalPattern: {
    pattern: "Multi-Claude parallel builds";
    directAdoption: "rejected";
    revisitPath: string;
  };
};

export type DecisionSource = {
  source: string;
  url: string;
  finding: string;
};

export type RuntimePhase = {
  id:
    | "claim-task"
    | "create-and-lock-worktree"
    | "prepare-environment"
    | "run-agent"
    | "validate-workspace"
    | "commit-workspace"
    | "merge-through-gate"
    | "resolve-bounded-conflicts"
    | "rerun-validation"
    | "update-state"
    | "cleanup";
  rule: string;
};

export type SafetyRule = {
  id:
    | "clean-canonical-checkout"
    | "pending-conflicts-stay-visible"
    | "untracked-work-preserved"
    | "binary-conflicts-never-auto"
    | "failed-validation-blocks-merge";
  rule: string;
};

export type RolloutStep = {
  order: 1 | 2 | 3 | 4;
  name:
    | "builder-workspace"
    | "status-and-cleanup"
    | "mutating-autonomy-workflows"
    | "guarded-parallelism";
  rule: string;
};
