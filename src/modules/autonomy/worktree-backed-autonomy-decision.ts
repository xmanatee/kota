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

export const WORKTREE_BACKED_AUTONOMY_DECISION = {
  id: "worktree-backed-autonomy",
  status: "accepted",
  date: "2026-06-26",
  summary:
    "KOTA keeps the daemon and operator-visible checkout on the canonical projectDir, " +
    "runs mutating autonomy work in leased workspaceDir git worktrees, and integrates " +
    "completed work only through task claims, validation, merge gates, and visible cleanup.",
  sourceRationale: [
    {
      source: "Claude Code worktrees",
      url: "https://code.claude.com/docs/en/worktrees",
      finding:
        "Worktrees isolate file edits by directory and branch, copy selected ignored setup " +
        "files, lock active worktrees, and avoid automatic cleanup when local or unpushed " +
        "work remains.",
    },
    {
      source: "Claude Code agent teams",
      url: "https://code.claude.com/docs/en/agent-teams",
      finding:
        "Parallel coding works best for independent tasks and carries coordination and token " +
        "overhead, so KOTA should keep scheduling inside the existing workflow engine.",
    },
    {
      source: "Codex app worktrees",
      url: "https://developers.openai.com/codex/app/worktrees",
      finding:
        "Background automations run in dedicated worktrees and handoff exists because local " +
        "and background checkouts have different verification and collaboration constraints.",
    },
    {
      source: "Jules and GitHub Copilot cloud agent",
      url: "https://jules.google/docs/",
      finding:
        "Cloud coding agents run tasks in cloned or ephemeral environments, choose a branch, " +
        "prepare dependencies, and return changes through branch or pull-request flows.",
    },
    {
      source: "AgenticFlict",
      url: "https://arxiv.org/html/2604.03551v2",
      finding:
        "The measured 27.67% textual conflict rate for simulated agentic PR merges makes a " +
        "first-class merge gate mandatory before enabling parallel builders.",
    },
    {
      source: "Where Do AI Coding Agents Fail?",
      url: "https://arxiv.org/html/2601.15195v1",
      finding:
        "Agentic PRs merge less often when they are larger, touch more files, or fail CI, " +
        "which argues for narrow task claims and validation before integration.",
    },
    {
      source: "SWE-bench Verified and SWE-bench Pro",
      url: "https://openai.com/index/introducing-swe-bench-verified/",
      finding:
        "Issue-driven patches need explicit pass/fail validation against the repo, not trust " +
        "in the agent's proposed patch or self-report.",
    },
    {
      source: "Practitioner worktree reports",
      url: "https://developer.upsun.com/posts/ai/git-worktrees-for-parallel-ai-coding-agents",
      finding:
        "Worktrees do not isolate ports, dependency installs, local databases, generated " +
        "artifacts, or semantic conflicts; KOTA must model those as resource and validation " +
        "concerns outside the git primitive.",
    },
  ],
  constrainedFiles: [
    "src/modules/autonomy/workflows/builder/workflow.ts",
    "src/modules/autonomy/workflows/builder/branch-per-task.ts",
    "src/modules/autonomy/workflow-workspace-policy.ts",
    "src/core/workflow/steps/step-executor-agent.ts",
    "src/core/workflow/steps/step-executor-agent-prompt.ts",
    "src/core/workflow/steps/step-executor-agent-run-options.ts",
    "src/modules/autonomy/recovery.ts",
    "src/modules/scheduler/config-slice.ts",
  ],
  localArchitecture: [
    "canonicalProjectDir is the daemon root, scope identity source, task/run store root, " +
      "operator-visible checkout, and place where final integration is observed.",
    "workspaceDir is a per-task mutable checkout created under KOTA runtime control and passed " +
      "to mutating workflow steps; run artifacts continue to live under canonicalProjectDir.",
    "The git module owns worktree lifecycle primitives. Builder code consumes typed lifecycle " +
      "operations instead of shelling out ad hoc or encoding lifecycle rules in prompts.",
    "Workflow step context gains workspaceDir beside projectDir. Agent cwd, tool cwd, mutation " +
      "tracking, and prompt context use workspaceDir when present; module roots and durable " +
      "run/task stores remain anchored at canonicalProjectDir.",
    "Task claims are atomic leases keyed by task id, run id, branch, workspaceDir, and expiry. " +
      "A builder can start only after claiming a dependency-clear task that has no active lease.",
    "Scheduler concurrency is a maximum dispatch budget, not permission to share a checkout. " +
      "Parallel builder dispatch stays disabled until leases, workspaceDir execution, merge " +
      "gating, status visibility, cleanup, and conflict fixtures are in place.",
    "Autonomy workflow workspace policy is recorded workflow-by-workflow in " +
      "workflow-workspace-policy.ts: builder is worktree/merge-gated, canonical exceptions " +
      "are limited to KOTA control-state or control-plane mutation, and external-effect " +
      "workflows stay out of worktrees.",
  ],
  runtimeShape: [
    {
      id: "claim-task",
      rule: "Atomically lease one dependency-clear task before changing task state or creating a branch.",
    },
    {
      id: "create-and-lock-worktree",
      rule:
        "Create a task branch worktree from the configured base, lock it, and record the " +
        "workspace path on the lease and run.",
    },
    {
      id: "prepare-environment",
      rule:
        "Copy only declared ignored setup files and run deterministic local setup before " +
        "the agent starts.",
    },
    {
      id: "run-agent",
      rule: "Run the builder agent with workspaceDir as cwd while preserving canonical run artifacts.",
    },
    {
      id: "validate-workspace",
      rule: "Run the task's narrow validation and required probes inside workspaceDir.",
    },
    {
      id: "commit-workspace",
      rule: "Commit only after validation passes and the task state matches the implemented result.",
    },
    {
      id: "merge-through-gate",
      rule:
        "Rebase or merge the committed task branch through a typed gate against the canonical checkout.",
    },
    {
      id: "resolve-bounded-conflicts",
      rule: "Attempt automated resolution only for classified, textual, bounded conflicts.",
    },
    {
      id: "rerun-validation",
      rule: "Rerun validation after every rebase, merge, or automated conflict resolution.",
    },
    {
      id: "update-state",
      rule: "Update task, lease, branch, and run state only after the merge gate and validation agree.",
    },
    {
      id: "cleanup",
      rule:
        "Unlock and remove worktrees only when committed, merged, pushed as required, and free of " +
        "uncommitted or untracked work.",
    },
  ],
  safetyRules: [
    {
      id: "clean-canonical-checkout",
      rule:
        "A dirty canonical checkout blocks worktree creation and merge integration. Existing dirt " +
        "must be attributed or recovered before a builder claims more work.",
    },
    {
      id: "pending-conflicts-stay-visible",
      rule:
        "Unresolved conflicts remain as a pending merge with the worktree, branch, lease, conflict " +
        "report, and task state visible. They are never hidden by stash, cleanup, or a done move.",
    },
    {
      id: "untracked-work-preserved",
      rule:
        "Untracked files in a workspace block cleanup until they are intentionally committed, ignored " +
        "by an explicit lifecycle rule, or surfaced in a pending-cleanup status.",
    },
    {
      id: "binary-conflicts-never-auto",
      rule:
        "Binary conflicts are never resolved automatically. They require an operator or a task-specific " +
        "manual follow-up and leave the merge pending.",
    },
    {
      id: "failed-validation-blocks-merge",
      rule:
        "Failed validation blocks merge, done-state updates, branch deletion, and worktree removal. The " +
        "run records the failed command and leaves the workspace available for repair.",
    },
  ],
  automatedConflictResolution: [
    "Allowed only after both sides are committed and the conflict classifier marks every conflicted " +
      "path as textual, tracked, non-secret, non-binary, and inside the task's declared write surface.",
    "Allowed only when canonicalProjectDir is clean and the resolver can run inside the conflicted " +
      "workspace with no external side effects beyond the merge branch.",
    "Allowed only when the resolver produces a conflict report and reruns the same validation gate " +
      "that would have been required for a clean merge.",
    "Not allowed for task-state moves, lease records, lockfiles, generated artifacts, or shared protocol " +
      "files unless a deterministic regeneration command is part of the gate.",
  ],
  pendingMergePolicy: [
    "If conflict classification fails, validation fails, a binary path appears, or untracked work exists, " +
      "the branch remains pending merge and the worktree is not removed.",
    "Pending merge state is operator-visible through run artifacts and future status/cleanup controls; " +
      "builders do not mark the task done while integration is unresolved.",
  ],
  workflowPolicy: {
    source: "src/modules/autonomy/workflow-workspace-policy.ts",
    rule:
      "Every autonomy workflow has a recorded workspace policy. The only arbitrary project " +
      "mutator is builder, which uses workspaceDir plus merge gate; canonical exceptions " +
      "must name their control-state/control-plane writes and safety mechanisms.",
  },
  rolloutOrder: [
    {
      order: 1,
      name: "builder-workspace",
      rule:
        "Move builder execution and repair into a single leased workspaceDir while keeping effective " +
        "builder concurrency at one.",
    },
    {
      order: 2,
      name: "status-and-cleanup",
      rule:
        "Expose worktree, lease, pending-merge, pending-cleanup, and manual cleanup controls before " +
        "more mutating workflows use worktrees.",
    },
    {
      order: 3,
      name: "mutating-autonomy-workflows",
      rule:
        "Migrate other file-mutating autonomy workflows to the same workspace policy after builder " +
        "status and cleanup are inspectable.",
    },
    {
      order: 4,
      name: "guarded-parallelism",
      rule:
        "Enable parallel builder dispatch only after conflict fixtures prove leases, merge gates, " +
        "validation reruns, pending-merge visibility, and cleanup behavior.",
    },
  ],
  revisitsExternalPattern: {
    pattern: "Multi-Claude parallel builds",
    directAdoption: "rejected",
    revisitPath:
      "Direct adoption remains rejected, but KOTA will re-enter the pattern through its own " +
      "workflow-native worktree path: workspaceDir step execution, git-module lifecycle, task " +
      "claim leases, merge gate, status/cleanup controls, and then guarded scheduler parallelism.",
  },
} as const satisfies WorktreeBackedAutonomyDecision;
