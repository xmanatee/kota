import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import {
  AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
  type AutonomyIssueProjection,
} from "./autonomy-issue-projection.js";

export function seedAutonomyIssueProjection(
  scopeRoot: string,
  stateDir: string,
  projection: AutonomyIssueProjection,
): void {
  const database = new RunStateDatabase(stateDir);
  try {
    const scopeId = database.getScopeIdByRootPath(scopeRoot) ?? deriveDirectoryScopeId(scopeRoot);
    const updatedAt = new Date().toISOString();
    database.registerScope({ id: scopeId, rootPath: scopeRoot, createdAt: updatedAt });
    const snapshot = database.readScopeStateValue(scopeId, AUTONOMY_ISSUE_PROJECTION_STATE_KEY);
    database.compareAndSetScopeStateValue({
      scopeId,
      key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
      expectedRevision: snapshot.revision,
      value: projection,
      updatedAt,
    });
  } finally {
    database.close();
  }
}
