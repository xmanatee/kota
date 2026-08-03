export type WorkflowCommitOutcome =
  | {
      committed: false;
      committedPaths: [];
      daemonRestartRequired: false;
    }
  | {
      committed: true;
      committedPaths: string[];
      daemonRestartRequired: boolean;
    };

export type CommitResult =
  | Extract<WorkflowCommitOutcome, { committed: false }>
  | (Extract<WorkflowCommitOutcome, { committed: true }> & {
      message: string;
      sha: string;
    });

export function decodeWorkflowCommitOutcome(raw: unknown): WorkflowCommitOutcome {
  if (!raw || typeof raw !== "object") {
    throw new Error("Commit step output must be an object");
  }
  const value = raw as Record<string, unknown>;
  if (
    !Array.isArray(value.committedPaths) ||
    value.committedPaths.some((path) => typeof path !== "string") ||
    typeof value.daemonRestartRequired !== "boolean"
  ) {
    throw new Error(
      "Commit step output must include committedPaths and daemonRestartRequired",
    );
  }
  const committedPaths = value.committedPaths as string[];
  if (value.committed === false) {
    if (committedPaths.length !== 0 || value.daemonRestartRequired) {
      throw new Error("An empty commit cannot require a daemon restart");
    }
    return { committed: false, committedPaths: [], daemonRestartRequired: false };
  }
  if (value.committed !== true) throw new Error("Commit output must report committed");
  return {
    committed: true,
    committedPaths,
    daemonRestartRequired: value.daemonRestartRequired,
  };
}
