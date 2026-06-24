import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  buildCompositionWorkspaceSnapshotArtifact,
  type CompositionWorkspaceSnapshotArtifact,
  restoreSnapshotFromArtifact,
} from "./workspace-snapshot-artifact.js";
import {
  hasWorkspaceScope,
  restoreWorkspaceScope,
  setWorkspaceScopeRecovery,
  snapshotWorkspaceScope,
} from "./workspace-store.js";
import type {
  WorkspaceRecoveryDiagnostic,
  WorkspaceScope,
} from "./workspace-types.js";

export const COMPOSITION_WORKSPACES_ARTIFACT = "composition-workspaces.json";

export type WorkspaceRestoreResult =
  | { status: "active" }
  | { status: "restored"; artifactPath: string }
  | { status: "missing"; artifactPath: string }
  | { status: "unavailable"; reason: string; artifactPath?: string };

function projectDirFromContext(context?: ToolRunnerContext): string {
  return context?.cwd ?? process.cwd();
}

function artifactPathFor(
  context: ToolRunnerContext | undefined,
  scope: WorkspaceScope,
): string | undefined {
  if (scope.kind !== "workflow") return undefined;
  return join(
    projectDirFromContext(context),
    ".kota",
    "runs",
    scope.runId,
    COMPOSITION_WORKSPACES_ARTIFACT,
  );
}

function displayPath(projectDir: string, path: string): string {
  const rel = relative(projectDir, path);
  return rel.startsWith("..") ? path : rel;
}

export function writeCompositionWorkspaceSnapshot(input: {
  context?: ToolRunnerContext;
  scope: WorkspaceScope;
  recovery?: WorkspaceRecoveryDiagnostic;
}): string | undefined {
  const artifactPath = artifactPathFor(input.context, input.scope);
  if (artifactPath === undefined) return undefined;
  const projectDir = projectDirFromContext(input.context);
  const snapshot = snapshotWorkspaceScope(input.scope);
  const artifact = buildCompositionWorkspaceSnapshotArtifact(
    snapshot,
    input.recovery ?? snapshot.recovery,
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return displayPath(projectDir, artifactPath);
}

export function restoreCompositionWorkspaceSnapshot(input: {
  context?: ToolRunnerContext;
  scope: WorkspaceScope;
}): WorkspaceRestoreResult {
  if (input.scope.kind !== "workflow") return { status: "active" };
  if (hasWorkspaceScope(input.scope)) return { status: "active" };

  const artifactPath = artifactPathFor(input.context, input.scope);
  if (artifactPath === undefined) return { status: "active" };
  const projectDir = projectDirFromContext(input.context);
  const display = displayPath(projectDir, artifactPath);
  if (!existsSync(artifactPath)) return { status: "missing", artifactPath: display };

  try {
    const artifact = JSON.parse(
      readFileSync(artifactPath, "utf-8"),
    ) as CompositionWorkspaceSnapshotArtifact;
    if (
      artifact.schemaVersion !== 1 ||
      artifact.artifactKind !== "composition-workspaces" ||
      artifact.scope.key !== input.scope.key
    ) {
      return {
        status: "unavailable",
        artifactPath: display,
        reason: "composition workspace snapshot schema or scope did not match",
      };
    }
    const recovery: WorkspaceRecoveryDiagnostic = {
      status: "restored",
      checkedAt: Date.now(),
      artifactPath: display,
    };
    restoreWorkspaceScope(restoreSnapshotFromArtifact(artifact, recovery));
    return { status: "restored", artifactPath: display };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      status: "unavailable",
      artifactPath: display,
      reason: `failed to read composition workspace snapshot: ${detail}`,
    };
  }
}

export function markWorkspaceRecoveryUnavailable(input: {
  scope: WorkspaceScope;
  reason: string;
  artifactPath?: string;
}): WorkspaceRecoveryDiagnostic {
  const recovery: WorkspaceRecoveryDiagnostic = {
    status: "unavailable",
    checkedAt: Date.now(),
    reason: input.reason,
    ...(input.artifactPath !== undefined ? { artifactPath: input.artifactPath } : {}),
  };
  setWorkspaceScopeRecovery(input.scope, recovery);
  return recovery;
}
