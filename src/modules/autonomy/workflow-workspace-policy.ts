export type WorkflowWorkspacePolicyKind =
  | "worktree-merge-gated"
  | "canonical-control-state"
  | "read-only-observer"
  | "external-effect-only";

export type TrackedMutationScope =
  | "arbitrary-project-files"
  | "autonomy-control-plane"
  | "task-control-state"
  | "runtime-state"
  | "none";

export type AutonomyWorkflowWorkspacePolicy = {
  workflow: string;
  kind: WorkflowWorkspacePolicyKind;
  trackedMutationScope: TrackedMutationScope;
  writes: readonly string[];
  reason: string;
  safetyMechanisms: readonly string[];
};

const CANONICAL_CONTROL_SAFETY = [
  "normal path checks the canonical checkout for tracked and untracked changes before writing",
  "task mutations stage exact paths through the repo-tasks API before validation",
  "tracked canonical mutators share one runtime concurrency group",
  "commit-stageable dry-run covers the exact canonical path set",
] as const;

export const AUTONOMY_CANONICAL_MUTATION_CONCURRENCY_GROUP =
  "autonomy-canonical-mutation";

export const AUTONOMY_WORKFLOW_WORKSPACE_POLICIES = [
  {
    workflow: "attention-digest",
    kind: "canonical-control-state",
    trackedMutationScope: "runtime-state",
    writes: ["recovery cleanup", "attention digest events"],
    reason:
      "Recovery attention has to inspect and report the canonical checkout that crashed; normal runs only read run evidence and emit digest events.",
    safetyMechanisms: [
      "recovery trigger runs reset before digesting",
      "normal path has no tracked repo writes",
    ],
  },
  {
    workflow: "autonomy-health-reviewer",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", "owner-question records", ".kota/runs/"],
    reason:
      "Health review turns runtime control signals into normal queue repairs and owner questions; those records must land in the canonical task/control state.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "backlog-promoter",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/backlog/", "data/tasks/ready/"],
    reason:
      "Backlog promotion is queue shaping for the canonical builder dispatcher, not implementation work that belongs on a task branch.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "blocked-promoter",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/blocked/", "data/tasks/ready/", "owner-decision markers"],
    reason:
      "Blocked promotion mutates typed blocker and owner-decision control state that the dispatcher must observe immediately in the canonical queue.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "builder",
    kind: "worktree-merge-gated",
    trackedMutationScope: "arbitrary-project-files",
    writes: ["workspaceDir task worktree", "canonical checkout through merge gate"],
    reason:
      "Builder owns arbitrary task implementation work, so it claims one task, edits in workspaceDir, commits there, and integrates through the merge gate.",
    safetyMechanisms: [
      "atomic task claim lease",
      "workspaceDir agent and repair-loop execution",
      "merge gate reruns validation before canonical integration",
      "pending merge and cleanup state stay visible",
    ],
  },
  {
    workflow: "daily-digest",
    kind: "canonical-control-state",
    trackedMutationScope: "runtime-state",
    writes: [".kota daily digest state", ".kota/runs/"],
    reason:
      "Daily digest is operator runtime state and event emission; a worktree would hide the cadence marker from the daemon.",
    safetyMechanisms: ["writes only .kota state and run artifacts"],
  },
  {
    workflow: "decomposer",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/"],
    reason:
      "Decomposer only reshapes the canonical task queue after a builder timeout; subtasks must be visible to the dispatcher immediately.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "dispatcher",
    kind: "canonical-control-state",
    trackedMutationScope: "runtime-state",
    writes: [".kota/scope-improvement/evidence-ready.json", "queue-shape events"],
    reason:
      "Dispatcher owns canonical queue observation and scope-improvement dedupe state; moving it into a worktree would make emitted state stale.",
    safetyMechanisms: ["does not edit tracked repo files", "writes only daemon control dedupe state"],
  },
  {
    workflow: "evaluator-calibration-monitor",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", ".kota/runs/"],
    reason:
      "Calibration drift opens, recreates, or promotes repair tasks in the canonical queue so the next dispatcher pass sees the corrective action.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "evaluator-calibration-notify",
    kind: "read-only-observer",
    trackedMutationScope: "none",
    writes: ["attention digest events"],
    reason:
      "The notifier only reshapes an already-decided calibration event into the attention channel.",
    safetyMechanisms: ["no local file writes"],
  },
  {
    workflow: "explorer",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", "data/watchlist.yaml", ".kota/explorer-state.json"],
    reason:
      "Explorer creates queue entries and updates the canonical watchlist when the queue is thin; these are control inputs for future task selection.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "fan-out-consolidator",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/ready/"],
    reason:
      "Fan-out consolidation seeds follow-up review tasks from completed batches; the seeded tasks are canonical queue state.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "github-mention-intake",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/ready/", "GitHub task-reference comments"],
    reason:
      "Trusted implementation mentions become canonical repo tasks before any builder can claim them; the optional GitHub reply is an approved external effect.",
    safetyMechanisms: [
      ...CANONICAL_CONTROL_SAFETY,
      "external comment path requires approval",
    ],
  },
  {
    workflow: "github-mention-responder",
    kind: "external-effect-only",
    trackedMutationScope: "none",
    writes: ["GitHub mention response comments"],
    reason:
      "The responder is passive locally and only posts one bounded approved GitHub comment.",
    safetyMechanisms: ["agent writeScope is empty", "external comment path requires approval"],
  },
  {
    workflow: "improver",
    kind: "canonical-control-state",
    trackedMutationScope: "autonomy-control-plane",
    writes: ["src/modules/autonomy/", "src/core/workflow/", "docs and task governance surfaces"],
    reason:
      "Improver repairs KOTA-owned autonomy control-plane files from aggregated run evidence; until non-task worktree leases exist, it stays canonical and shares the tracked-mutation concurrency group.",
    safetyMechanisms: [
      "clean-checkout preflight gates the agent step",
      "tracked canonical mutators share one runtime concurrency group",
      "broad build, workflow validation, task validation, typecheck, lint, and test repair-loop checks",
      "commit-stageable dry-run covers the canonical path set",
      "restart happens only after a committed change",
    ],
  },
  {
    workflow: "inbox-sorter",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/inbox/", "data/tasks/", "data/"],
    reason:
      "Inbox sorting turns rough captures into canonical project data; the sorted result must be visible to queue validation and dispatcher routing.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "owner-intervention-escalator",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", ".kota/runs/"],
    reason:
      "Owner-intervention patterns become repair tasks in the canonical queue and attention artifacts in the run record.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "pr-reviewer",
    kind: "external-effect-only",
    trackedMutationScope: "none",
    writes: ["GitHub PR review comments"],
    reason:
      "PR reviewer drafts advisory output and posts only after the configured GitHub comment policy allows it.",
    safetyMechanisms: ["agent writeScope is empty", "external comment path is policy-gated"],
  },
  {
    workflow: "progress-reviewer",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", "owner-question records", ".kota/runs/"],
    reason:
      "Progress review turns bounded activity evidence into canonical steering tasks or owner questions for future workflow routing.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "repo-ai-checks",
    kind: "external-effect-only",
    trackedMutationScope: "none",
    writes: [".kota/runs/", "GitHub PR check comments"],
    reason:
      "Repo AI checks produce run artifacts and optional advisory comments; they do not mutate tracked local files.",
    safetyMechanisms: ["agent writeScope is empty", "external comment path is policy-gated"],
  },
  {
    workflow: "research-retry",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", "data/inbox/"],
    reason:
      "Research retry updates one blocked research task or related inbox/task follow-up after re-reading sources; it no longer edits autonomy source files.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "review-scrutiny-escalator",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", ".kota/runs/"],
    reason:
      "Review scrutiny escalation opens or refreshes repair tasks from repeated review-quality patterns.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "scope-improver",
    kind: "canonical-control-state",
    trackedMutationScope: "autonomy-control-plane",
    writes: ["data/tasks/", "owner-question records", "scoped AGENTS.md safe edits"],
    reason:
      "Scope improver updates scope-local control instructions and follow-up tasks that clients and future runs must read from the canonical project path.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "security-review",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", ".kota/runs/"],
    reason:
      "Security review agents write only investigation artifacts; code steps create or update canonical vulnerability follow-up tasks.",
    safetyMechanisms: [
      "agent writeScope is limited to .kota/runs/",
      ...CANONICAL_CONTROL_SAFETY,
    ],
  },
  {
    workflow: "trajectory-diagnostic-escalator",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", ".kota/runs/"],
    reason:
      "Trajectory diagnostics become canonical repair tasks when repeated process-quality patterns cross threshold.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
  {
    workflow: "workflow-failure-escalator",
    kind: "canonical-control-state",
    trackedMutationScope: "task-control-state",
    writes: ["data/tasks/", ".kota/runs/"],
    reason:
      "Persistent workflow failures become canonical repair tasks so runtime failures do not stay notification-only.",
    safetyMechanisms: CANONICAL_CONTROL_SAFETY,
  },
] as const satisfies readonly AutonomyWorkflowWorkspacePolicy[];

export function workflowWorkspacePolicyFor(
  workflow: string,
): AutonomyWorkflowWorkspacePolicy | undefined {
  return AUTONOMY_WORKFLOW_WORKSPACE_POLICIES.find(
    (policy) => policy.workflow === workflow,
  );
}

export function autonomyWorkflowConcurrencyGroupFor(
  workflow: string,
): string | undefined {
  const policy = workflowWorkspacePolicyFor(workflow);
  if (
    policy?.kind === "canonical-control-state" &&
    policy.trackedMutationScope !== "runtime-state" &&
    policy.trackedMutationScope !== "none"
  ) {
    return AUTONOMY_CANONICAL_MUTATION_CONCURRENCY_GROUP;
  }
  return undefined;
}
