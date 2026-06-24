export type WorkspaceScope =
  | {
      kind: "workflow";
      key: string;
      workflowName: string;
      runId: string;
      scopeId: string;
      projectId: string;
    }
  | {
      kind: "session";
      key: string;
      sessionId: string;
    }
  | {
      kind: "process";
      key: "process";
    };

export type WorkspaceSource =
  | {
      kind: "workflow";
      workflowName: string;
      runId: string;
      stepId: string;
      spanId: string;
      scopeId: string;
      projectId: string;
      toolUseId?: string;
      sessionId?: string;
    }
  | {
      kind: "session";
      sessionId: string;
      toolUseId?: string;
    }
  | {
      kind: "process";
      toolUseId?: string;
    };

export type WorkspaceOperationAction =
  | "create"
  | "write"
  | "read"
  | "read-all"
  | "list"
  | "delete-entry"
  | "delete-workspace";

export type WorkspaceOperation = {
  action: WorkspaceOperationAction;
  at: number;
  source: WorkspaceSource;
  status: "ok" | "missing";
  workspace?: string;
  key?: string;
  author?: string;
  lastWriter?: string;
  value?: string;
  detail?: string;
};

export type WorkspaceRecoveryDiagnostic =
  | {
      status: "restored";
      checkedAt: number;
      artifactPath: string;
    }
  | {
      status: "unavailable";
      checkedAt: number;
      reason: string;
      artifactPath?: string;
    };

export type WorkspaceEntry = {
  key: string;
  value: string;
  author?: string;
  createdAt: number;
  updatedAt: number;
  source: WorkspaceSource;
  lastWriter: string;
};

export type Workspace = {
  name: string;
  scope: WorkspaceScope;
  entries: Map<string, WorkspaceEntry>;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceSnapshot = {
  scope: WorkspaceScope;
  recovery?: WorkspaceRecoveryDiagnostic;
  workspaces: Array<{
    name: string;
    createdAt: number;
    updatedAt: number;
    entries: WorkspaceEntry[];
  }>;
  operations: WorkspaceOperation[];
};
