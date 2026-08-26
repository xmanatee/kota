import type { WorkflowDispatchPauseStatus } from "#core/workflow/dispatch-pause-types.js";
import type {
  OperationalRun,
  RunOperationalProjection,
} from "#core/workflow/run-operational-projection.js";

export type DaemonControlIdentity =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "stale"; pid: number; baseURL: string }
  | { kind: "fresh"; pid: number; baseURL: string };

export type StatusDashboard =
  | { available: true; url: string }
  | { available: false; reason: string; message?: string };

export type StatusWorkspaceEvidence =
  | {
      available: true;
      headCommit: string;
      dirty: boolean;
      dirtySummary: string;
    }
  | {
      available: false;
      headCommit: null;
      dirty: null;
      dirtySummary: string;
    };

type StatusRunSandboxBase = {
  runId: string;
  rootDir: string;
  workspaceDir: string;
  tempDir: string;
  artifactDir: string;
};

export type StatusRunSandbox =
  | (StatusRunSandboxBase & {
      repository: "none";
      branch: null;
      baseCommit: null;
      workspace: null;
    })
  | (StatusRunSandboxBase & {
      repository: "read";
      branch: null;
      baseCommit: string;
      workspace: StatusWorkspaceEvidence;
    })
  | (StatusRunSandboxBase & {
      repository: "write";
      branch: string;
      baseCommit: string;
      workspace: StatusWorkspaceEvidence;
    });

export type StatusOperationalRun = Omit<OperationalRun, "sandbox"> & {
  sandbox: StatusRunSandbox | null;
};

export type StatusRunProjection = Omit<RunOperationalProjection, "runs"> & {
  runs: StatusOperationalRun[];
};

export type StatusSnapshot = {
  daemonRunning: boolean;
  daemonPid?: number;
  daemonUptimeMs?: number;
  activeRuns: number;
  queuedRuns: number;
  workflowPaused: boolean;
  workflowPause?: WorkflowDispatchPauseStatus;
  sessions: number;
  pendingApprovals: number;
  scopeRoot: string;
  scopeName: string;
  controlFile: DaemonControlIdentity;
  strandedDaemon?: { pid: number; command: string };
  daemonScopeRoot?: string;
  daemonScopeName?: string;
  selectedScope?: { scopeId: string; scopeRoot: string; displayName: string };
  wrongScope?: boolean;
  dashboard?: StatusDashboard;
  runProjection: StatusRunProjection;
};

export type StatusGatherOptions = {
  scopeId?: string;
};
