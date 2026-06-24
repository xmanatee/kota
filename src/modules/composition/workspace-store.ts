/**
 * WorkspaceStore — shared blackboard for multi-agent coordination.
 *
 * Workspaces are named, run/session-scoped key-value stores that multiple
 * agents (parent + delegates) can read/write concurrently. Entries are strings
 * (JSON, markdown, plain text) identified by a key within a workspace.
 *
 * Lifecycle: process memory is only the hot cache. Workflow-scoped runs write
 * bounded coordination snapshots under their run directory; use the knowledge
 * store for durable semantic memory.
 */

import {
  processWorkspaceScope,
  processWorkspaceSource,
  workspaceSourceLabel,
} from "./workspace-scope.js";
import {
  bucketFor,
  recordOperation,
  workspaceBucket,
} from "./workspace-store-state.js";
import type {
  Workspace,
  WorkspaceEntry,
  WorkspaceScope,
  WorkspaceSource,
} from "./workspace-types.js";

export {
  resolveWorkspaceScope,
  workspaceSourceFromContext,
} from "./workspace-scope.js";
export {
  clearAllWorkspaces,
  hasWorkspaceScope,
  restoreWorkspaceScope,
  setWorkspaceScopeRecovery,
  snapshotWorkspaceScope,
} from "./workspace-store-state.js";
export type {
  Workspace,
  WorkspaceEntry,
  WorkspaceRecoveryDiagnostic,
  WorkspaceScope,
  WorkspaceSnapshot,
  WorkspaceSource,
} from "./workspace-types.js";

export function createWorkspace(
  name: string,
  scope: WorkspaceScope = processWorkspaceScope(),
  source: WorkspaceSource = processWorkspaceSource(),
): Workspace {
  const bucket = bucketFor(scope);
  const existing = bucket.workspaces.get(name);
  if (existing) {
    recordOperation(scope, {
      action: "create",
      at: Date.now(),
      source,
      status: "ok",
      workspace: name,
      detail: "already-exists",
    });
    return existing;
  }
  const now = Date.now();
  const ws: Workspace = {
    name,
    scope,
    entries: new Map(),
    createdAt: now,
    updatedAt: now,
  };
  bucket.workspaces.set(name, ws);
  recordOperation(scope, {
    action: "create",
    at: now,
    source,
    status: "ok",
    workspace: name,
  });
  return ws;
}

export function getWorkspace(
  name: string,
  scope: WorkspaceScope = processWorkspaceScope(),
): Workspace | undefined {
  return workspaceBucket(scope)?.workspaces.get(name);
}

export function writeEntry(
  workspaceName: string,
  key: string,
  value: string,
  author?: string,
  scope: WorkspaceScope = processWorkspaceScope(),
  source: WorkspaceSource = processWorkspaceSource(),
): WorkspaceEntry {
  const bucket = bucketFor(scope);
  let ws = bucket.workspaces.get(workspaceName);
  if (!ws) {
    ws = createWorkspace(workspaceName, scope, source);
  }
  const now = Date.now();
  const existing = ws.entries.get(key);
  const lastWriter = author ?? workspaceSourceLabel(source);
  const entry: WorkspaceEntry = {
    key,
    value,
    ...(author !== undefined ? { author } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    source,
    lastWriter,
  };
  ws.entries.set(key, entry);
  ws.updatedAt = now;
  recordOperation(scope, {
    action: "write",
    at: now,
    source,
    status: "ok",
    workspace: workspaceName,
    key,
    value,
    ...(author !== undefined ? { author } : {}),
    lastWriter,
  });
  return entry;
}

export function readEntry(
  workspaceName: string,
  key: string,
  scope: WorkspaceScope = processWorkspaceScope(),
): WorkspaceEntry | undefined {
  return workspaceBucket(scope)?.workspaces.get(workspaceName)?.entries.get(key);
}

export function readAllEntries(
  workspaceName: string,
  scope: WorkspaceScope = processWorkspaceScope(),
): WorkspaceEntry[] {
  const ws = workspaceBucket(scope)?.workspaces.get(workspaceName);
  if (!ws) return [];
  return [...ws.entries.values()].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
    return a.key.localeCompare(b.key);
  });
}

export function recordWorkspaceRead(input: {
  scope: WorkspaceScope;
  source: WorkspaceSource;
  workspace: string;
  key?: string;
  found: boolean;
}): void {
  recordOperation(input.scope, {
    action: input.key ? "read" : "read-all",
    at: Date.now(),
    source: input.source,
    status: input.found ? "ok" : "missing",
    workspace: input.workspace,
    ...(input.key !== undefined ? { key: input.key } : {}),
  });
}

export function recordWorkspaceList(input: {
  scope: WorkspaceScope;
  source: WorkspaceSource;
  count: number;
}): void {
  recordOperation(input.scope, {
    action: "list",
    at: Date.now(),
    source: input.source,
    status: input.count > 0 ? "ok" : "missing",
    detail: `${input.count} workspace(s)`,
  });
}

export function deleteEntry(
  workspaceName: string,
  key: string,
  scope: WorkspaceScope = processWorkspaceScope(),
  source: WorkspaceSource = processWorkspaceSource(),
): boolean {
  const ws = workspaceBucket(scope)?.workspaces.get(workspaceName);
  const ok = ws?.entries.delete(key) ?? false;
  const now = Date.now();
  if (ws && ok) ws.updatedAt = now;
  recordOperation(scope, {
    action: "delete-entry",
    at: now,
    source,
    status: ok ? "ok" : "missing",
    workspace: workspaceName,
    key,
  });
  return ok;
}

export function deleteWorkspace(
  name: string,
  scope: WorkspaceScope = processWorkspaceScope(),
  source: WorkspaceSource = processWorkspaceSource(),
): boolean {
  const bucket = bucketFor(scope);
  const ok = bucket.workspaces.delete(name);
  recordOperation(scope, {
    action: "delete-workspace",
    at: Date.now(),
    source,
    status: ok ? "ok" : "missing",
    workspace: name,
  });
  return ok;
}

export function listWorkspaces(): Array<{
  name: string;
  entryCount: number;
  createdAt: number;
}>;
export function listWorkspaces(
  scope?: WorkspaceScope,
): Array<{
  name: string;
  entryCount: number;
  createdAt: number;
}>;
export function listWorkspaces(
  scope: WorkspaceScope = processWorkspaceScope(),
): Array<{
  name: string;
  entryCount: number;
  createdAt: number;
}> {
  const bucket = workspaceBucket(scope);
  if (!bucket) return [];
  return [...bucket.workspaces.values()].map((ws) => ({
    name: ws.name,
    entryCount: ws.entries.size,
    createdAt: ws.createdAt,
  })).sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.name.localeCompare(b.name);
  });
}
