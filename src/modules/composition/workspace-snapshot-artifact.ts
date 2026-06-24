import { maskToolResultSecrets } from "#core/tools/secret-masking.js";
import type {
  WorkspaceEntry,
  WorkspaceOperation,
  WorkspaceRecoveryDiagnostic,
  WorkspaceScope,
  WorkspaceSnapshot,
  WorkspaceSource,
} from "./workspace-types.js";

const MAX_WORKSPACES = 20;
const MAX_ENTRIES_PER_WORKSPACE = 100;
const MAX_OPERATIONS = 200;
const MAX_ENTRY_VALUE_CHARS = 4_000;
const MAX_OPERATION_VALUE_CHARS = 500;
const MAX_LABEL_CHARS = 200;

type SanitizedText = {
  value: string;
  truncated: boolean;
  originalLength: number;
};

type ArtifactEntry = {
  key: string;
  value: string;
  author?: string;
  createdAt: number;
  updatedAt: number;
  source: WorkspaceSource;
  lastWriter: string;
  valueTruncated?: boolean;
  originalValueLength?: number;
};

type ArtifactOperation = {
  action: WorkspaceOperation["action"];
  at: number;
  source: WorkspaceSource;
  status: WorkspaceOperation["status"];
  workspace?: string;
  key?: string;
  author?: string;
  lastWriter?: string;
  valuePreview?: string;
  valueTruncated?: boolean;
  originalValueLength?: number;
  detail?: string;
};

export type CompositionWorkspaceSnapshotArtifact = {
  schemaVersion: 1;
  artifactKind: "composition-workspaces";
  generatedAt: string;
  scope: WorkspaceScope;
  recovery?: WorkspaceRecoveryDiagnostic;
  limits: {
    maxWorkspaces: number;
    maxEntriesPerWorkspace: number;
    maxOperations: number;
    maxEntryValueChars: number;
    maxOperationValueChars: number;
    maxLabelChars: number;
  };
  diagnostics: {
    omittedWorkspaces: number;
    omittedEntries: number;
    omittedOperations: number;
    truncatedValues: number;
  };
  workspaces: Array<{
    name: string;
    createdAt: number;
    updatedAt: number;
    entryCount: number;
    entries: ArtifactEntry[];
  }>;
  operations: ArtifactOperation[];
};

function sanitizeText(value: string, limit: number): SanitizedText {
  const masked = maskToolResultSecrets({ content: value }).content;
  if (masked.length <= limit) {
    return { value: masked, truncated: false, originalLength: value.length };
  }
  return {
    value: `${masked.slice(0, limit)}\n... (truncated)`,
    truncated: true,
    originalLength: value.length,
  };
}

function sanitizeLabel(value: string): string {
  return sanitizeText(value, MAX_LABEL_CHARS).value;
}

function artifactEntry(entry: WorkspaceEntry): {
  entry: ArtifactEntry;
  truncated: boolean;
} {
  const value = sanitizeText(entry.value, MAX_ENTRY_VALUE_CHARS);
  return {
    truncated: value.truncated,
    entry: {
      key: sanitizeLabel(entry.key),
      value: value.value,
      ...(entry.author !== undefined ? { author: sanitizeLabel(entry.author) } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      source: entry.source,
      lastWriter: sanitizeLabel(entry.lastWriter),
      ...(value.truncated ? { valueTruncated: true } : {}),
      ...(value.truncated ? { originalValueLength: value.originalLength } : {}),
    },
  };
}

function artifactOperation(operation: WorkspaceOperation): {
  operation: ArtifactOperation;
  truncated: boolean;
} {
  const value = operation.value === undefined
    ? undefined
    : sanitizeText(operation.value, MAX_OPERATION_VALUE_CHARS);
  return {
    truncated: value?.truncated === true,
    operation: {
      action: operation.action,
      at: operation.at,
      source: operation.source,
      status: operation.status,
      ...(operation.workspace !== undefined
        ? { workspace: sanitizeLabel(operation.workspace) }
        : {}),
      ...(operation.key !== undefined ? { key: sanitizeLabel(operation.key) } : {}),
      ...(operation.author !== undefined
        ? { author: sanitizeLabel(operation.author) }
        : {}),
      ...(operation.lastWriter !== undefined
        ? { lastWriter: sanitizeLabel(operation.lastWriter) }
        : {}),
      ...(value !== undefined ? { valuePreview: value.value } : {}),
      ...(value?.truncated === true ? { valueTruncated: true } : {}),
      ...(value?.truncated === true
        ? { originalValueLength: value.originalLength }
        : {}),
      ...(operation.detail !== undefined
        ? { detail: sanitizeLabel(operation.detail) }
        : {}),
    },
  };
}

export function buildCompositionWorkspaceSnapshotArtifact(
  snapshot: WorkspaceSnapshot,
  recovery: WorkspaceRecoveryDiagnostic | undefined,
): CompositionWorkspaceSnapshotArtifact {
  let omittedEntries = 0;
  let truncatedValues = 0;
  const workspaces = snapshot.workspaces.slice(0, MAX_WORKSPACES).map((workspace) => {
    const entries = workspace.entries.slice(0, MAX_ENTRIES_PER_WORKSPACE).map((entry) => {
      const serialized = artifactEntry(entry);
      if (serialized.truncated) truncatedValues += 1;
      return serialized.entry;
    });
    omittedEntries += Math.max(0, workspace.entries.length - entries.length);
    return {
      name: sanitizeLabel(workspace.name),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      entryCount: workspace.entries.length,
      entries,
    };
  });

  const operations = snapshot.operations.slice(-MAX_OPERATIONS).map((operation) => {
    const serialized = artifactOperation(operation);
    if (serialized.truncated) truncatedValues += 1;
    return serialized.operation;
  });

  return {
    schemaVersion: 1,
    artifactKind: "composition-workspaces",
    generatedAt: new Date().toISOString(),
    scope: snapshot.scope,
    ...(recovery !== undefined ? { recovery } : {}),
    limits: {
      maxWorkspaces: MAX_WORKSPACES,
      maxEntriesPerWorkspace: MAX_ENTRIES_PER_WORKSPACE,
      maxOperations: MAX_OPERATIONS,
      maxEntryValueChars: MAX_ENTRY_VALUE_CHARS,
      maxOperationValueChars: MAX_OPERATION_VALUE_CHARS,
      maxLabelChars: MAX_LABEL_CHARS,
    },
    diagnostics: {
      omittedWorkspaces: Math.max(0, snapshot.workspaces.length - workspaces.length),
      omittedEntries,
      omittedOperations: Math.max(0, snapshot.operations.length - operations.length),
      truncatedValues,
    },
    workspaces,
    operations,
  };
}

export function restoreSnapshotFromArtifact(
  artifact: CompositionWorkspaceSnapshotArtifact,
  recovery: WorkspaceRecoveryDiagnostic,
): WorkspaceSnapshot {
  return {
    scope: artifact.scope,
    recovery,
    workspaces: artifact.workspaces.map((workspace) => ({
      name: workspace.name,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      entries: workspace.entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        ...(entry.author !== undefined ? { author: entry.author } : {}),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        source: entry.source,
        lastWriter: entry.lastWriter,
      })),
    })),
    operations: artifact.operations.map((operation) => {
      const restored: WorkspaceOperation = {
        action: operation.action,
        at: operation.at,
        source: operation.source,
        status: operation.status,
      };
      if (operation.workspace !== undefined) restored.workspace = operation.workspace;
      if (operation.key !== undefined) restored.key = operation.key;
      if (operation.author !== undefined) restored.author = operation.author;
      if (operation.lastWriter !== undefined) restored.lastWriter = operation.lastWriter;
      if (operation.valuePreview !== undefined) restored.value = operation.valuePreview;
      if (operation.detail !== undefined) restored.detail = operation.detail;
      return restored;
    }),
  };
}
