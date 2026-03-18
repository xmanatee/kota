/**
 * WorkspaceStore — shared blackboard for multi-agent coordination.
 *
 * Workspaces are named, in-memory key-value stores that multiple agents
 * (parent + delegates) can read/write concurrently. Entries are strings
 * (JSON, markdown, plain text) identified by a key within a workspace.
 *
 * Lifecycle: workspaces live for the duration of the process. They are
 * not persisted — use the knowledge store for durable data.
 */

export type WorkspaceEntry = {
  key: string;
  value: string;
  author?: string;
  updatedAt: number;
};

export type Workspace = {
  name: string;
  entries: Map<string, WorkspaceEntry>;
  createdAt: number;
};

const workspaces = new Map<string, Workspace>();

export function createWorkspace(name: string): Workspace {
  if (workspaces.has(name)) {
    return workspaces.get(name)!;
  }
  const ws: Workspace = {
    name,
    entries: new Map(),
    createdAt: Date.now(),
  };
  workspaces.set(name, ws);
  return ws;
}

export function getWorkspace(name: string): Workspace | undefined {
  return workspaces.get(name);
}

export function writeEntry(
  workspaceName: string,
  key: string,
  value: string,
  author?: string,
): WorkspaceEntry {
  let ws = workspaces.get(workspaceName);
  if (!ws) {
    ws = createWorkspace(workspaceName);
  }
  const entry: WorkspaceEntry = { key, value, author, updatedAt: Date.now() };
  ws.entries.set(key, entry);
  return entry;
}

export function readEntry(
  workspaceName: string,
  key: string,
): WorkspaceEntry | undefined {
  return workspaces.get(workspaceName)?.entries.get(key);
}

export function readAllEntries(workspaceName: string): WorkspaceEntry[] {
  const ws = workspaces.get(workspaceName);
  if (!ws) return [];
  return [...ws.entries.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

export function deleteEntry(workspaceName: string, key: string): boolean {
  return workspaces.get(workspaceName)?.entries.delete(key) ?? false;
}

export function deleteWorkspace(name: string): boolean {
  return workspaces.delete(name);
}

export function listWorkspaces(): Array<{
  name: string;
  entryCount: number;
  createdAt: number;
}> {
  return [...workspaces.values()].map((ws) => ({
    name: ws.name,
    entryCount: ws.entries.size,
    createdAt: ws.createdAt,
  }));
}

export function clearAllWorkspaces(): void {
  workspaces.clear();
}
