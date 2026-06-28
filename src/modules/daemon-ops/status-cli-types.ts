import type { WorkflowRecoveryState } from "#core/workflow/run-types.js";
import type { AutomationWorktreeOperatorStatus } from "#modules/git/worktree-lifecycle.js";

export type DaemonControlIdentity =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "stale"; pid: number; baseURL: string }
  | { kind: "fresh"; pid: number; baseURL: string };

export type StatusDashboard =
  | { available: true; url: string }
  | { available: false; reason: string; message?: string };

export type StatusSnapshot = {
  daemonRunning: boolean;
  daemonPid?: number;
  daemonUptimeMs?: number;
  activeRuns: number;
  queuedRuns: number;
  workflowPaused: boolean;
  sessions: number;
  pendingApprovals: number;
  projectDir: string;
  projectName: string;
  controlFile: DaemonControlIdentity;
  strandedDaemon?: { pid: number; command: string };
  daemonProjectDir?: string;
  daemonProjectName?: string;
  scopedProject?: { projectId: string; projectDir: string; displayName: string };
  wrongProject?: boolean;
  dashboard?: StatusDashboard;
  historicalWorkflow?: {
    activeRuns: number;
    queuedRuns: number;
    workflowPaused: boolean;
  };
  pendingRecovery?: Pick<
    WorkflowRecoveryState,
    "sourceWorkflow" | "sourceRunId" | "dirtyCheckout" | "worktreeSummary" | "attempts"
  >;
  worktrees?: AutomationWorktreeOperatorStatus[];
};

export type StatusGatherOptions = {
  projectId?: string;
};
