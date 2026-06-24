import type {
  Workspace,
  WorkspaceOperation,
  WorkspaceRecoveryDiagnostic,
  WorkspaceScope,
  WorkspaceSnapshot,
} from "./workspace-types.js";

const MAX_IN_MEMORY_OPERATIONS = 500;

export type ScopeBucket = {
  scope: WorkspaceScope;
  workspaces: Map<string, Workspace>;
  operations: WorkspaceOperation[];
  recovery?: WorkspaceRecoveryDiagnostic;
};

const scopedWorkspaces = new Map<string, ScopeBucket>();

export function bucketFor(scope: WorkspaceScope): ScopeBucket {
  let bucket = scopedWorkspaces.get(scope.key);
  if (bucket) return bucket;
  bucket = {
    scope,
    workspaces: new Map(),
    operations: [],
  };
  scopedWorkspaces.set(scope.key, bucket);
  return bucket;
}

export function workspaceBucket(scope: WorkspaceScope): ScopeBucket | undefined {
  return scopedWorkspaces.get(scope.key);
}

export function hasWorkspaceScope(scope: WorkspaceScope): boolean {
  return scopedWorkspaces.has(scope.key);
}

export function recordOperation(
  scope: WorkspaceScope,
  operation: WorkspaceOperation,
): void {
  const bucket = bucketFor(scope);
  bucket.operations.push(operation);
  if (bucket.operations.length > MAX_IN_MEMORY_OPERATIONS) {
    bucket.operations.splice(
      0,
      bucket.operations.length - MAX_IN_MEMORY_OPERATIONS,
    );
  }
}

export function setWorkspaceScopeRecovery(
  scope: WorkspaceScope,
  recovery: WorkspaceRecoveryDiagnostic,
): void {
  bucketFor(scope).recovery = recovery;
}

export function snapshotWorkspaceScope(
  scope: WorkspaceScope,
): WorkspaceSnapshot {
  const bucket = scopedWorkspaces.get(scope.key);
  if (!bucket) {
    return {
      scope,
      workspaces: [],
      operations: [],
    };
  }
  return {
    scope: bucket.scope,
    ...(bucket.recovery !== undefined ? { recovery: bucket.recovery } : {}),
    workspaces: [...bucket.workspaces.values()].map((ws) => ({
      name: ws.name,
      createdAt: ws.createdAt,
      updatedAt: ws.updatedAt,
      entries: [...ws.entries.values()].sort((a, b) => {
        if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
        return a.key.localeCompare(b.key);
      }),
    })).sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.name.localeCompare(b.name);
    }),
    operations: [...bucket.operations],
  };
}

export function restoreWorkspaceScope(snapshot: WorkspaceSnapshot): void {
  const bucket: ScopeBucket = {
    scope: snapshot.scope,
    workspaces: new Map(),
    operations: snapshot.operations.slice(-MAX_IN_MEMORY_OPERATIONS),
    ...(snapshot.recovery !== undefined ? { recovery: snapshot.recovery } : {}),
  };
  for (const workspace of snapshot.workspaces) {
    bucket.workspaces.set(workspace.name, {
      name: workspace.name,
      scope: snapshot.scope,
      entries: new Map(workspace.entries.map((entry) => [entry.key, entry])),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    });
  }
  scopedWorkspaces.set(snapshot.scope.key, bucket);
}

export function clearAllWorkspaces(): void {
  scopedWorkspaces.clear();
}
