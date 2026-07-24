import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type {
  WorkflowDispatchPauseStatus,
  WorkflowRecoveryStatus,
} from "./recovery-status-types.js";
import type {
  WorkflowRecoveryDirtyCheckout,
  WorkflowRecoveryState,
} from "./run-types.js";
import { PAUSE_SIGNAL_FILE } from "./runtime-signals.js";

type RecoveryStoreAccess = {
  getRecovery(): WorkflowRecoveryState | null;
  setRecovery(recovery: WorkflowRecoveryState | null): void;
};

type PauseSignal =
  | { kind: "operator" }
  | { kind: "legacy-empty" }
  | {
      kind: "dirty-recovery";
      sourceRunId: string;
      sourceWorkflow: string;
    };

const OPERATOR_PAUSE_MESSAGE = "Persistent operator pause.";
const RUNTIME_PAUSE_MESSAGE = "Workflow dispatch is paused in the running daemon.";

export function normalizeDirtyCheckout(
  dirtyCheckout: WorkflowRecoveryDirtyCheckout | undefined,
): WorkflowRecoveryDirtyCheckout {
  return dirtyCheckout ?? "canonical";
}

export function recoveryWorktreeDir(input: {
  projectDir: string;
  workspaceDir?: string;
  dirtyCheckout: WorkflowRecoveryDirtyCheckout;
}): string | null {
  return input.dirtyCheckout === "workspace"
    ? input.workspaceDir ?? null
    : input.projectDir;
}

export function nextActionForRecovery(
  recovery: Pick<WorkflowRecoveryState, "attempts">,
): string {
  return recovery.attempts >= 1
    ? "Clean or stash the dirty checkout, then run `kota workflow resume`."
    : "Start the daemon to run recovery, or clean the checkout before resuming dispatch.";
}

function unavailableAction(): string {
  return "Fix git status access before clearing recovery or resuming dispatch.";
}

function unavailableRecovery(
  recovery: WorkflowRecoveryState,
  dirtyCheckout: WorkflowRecoveryDirtyCheckout,
  reason: string,
): WorkflowRecoveryStatus {
  return {
    status: "unavailable",
    ...recoveryProjection(recovery, dirtyCheckout),
    worktreeSummary: reason,
    unavailableReason: reason,
    nextAction: unavailableAction(),
  };
}

function recoveryProjection(
  recovery: WorkflowRecoveryState,
  dirtyCheckout: WorkflowRecoveryDirtyCheckout,
): Omit<Exclude<WorkflowRecoveryStatus, { status: "none" }>, "status" | "unavailableReason"> {
  return {
    sourceRunId: recovery.sourceRunId,
    sourceWorkflow: recovery.sourceWorkflow,
    dirtyCheckout,
    worktreeFingerprint: recovery.worktreeFingerprint,
    worktreeSummary: recovery.worktreeSummary,
    attempts: recovery.attempts,
    retryAttemptedBy: recovery.retryAttemptedBy,
    updatedAt: recovery.updatedAt,
    nextAction: nextActionForRecovery(recovery),
  };
}

function pauseSignalPath(projectDir: string): string {
  return join(projectDir, ".kota", PAUSE_SIGNAL_FILE);
}

function parsePauseSignal(projectDir: string): PauseSignal | null {
  const path = pauseSignalPath(projectDir);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  if (raw.length === 0) return { kind: "legacy-empty" };

  let parsed: {
    kind?: string;
    sourceRunId?: string;
    sourceWorkflow?: string;
  };
  try {
    parsed = JSON.parse(raw) as {
      kind?: string;
      sourceRunId?: string;
      sourceWorkflow?: string;
    };
  } catch {
    return { kind: "operator" };
  }

  if (
    parsed.kind === "dirty-recovery" &&
    typeof parsed.sourceRunId === "string" &&
    typeof parsed.sourceWorkflow === "string"
  ) {
    return {
      kind: "dirty-recovery",
      sourceRunId: parsed.sourceRunId,
      sourceWorkflow: parsed.sourceWorkflow,
    };
  }
  return { kind: "operator" };
}

export function writeOperatorPauseSignal(projectDir: string): void {
  const path = pauseSignalPath(projectDir);
  mkdirSync(join(projectDir, ".kota"), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ kind: "operator", pausedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

export function writeDirtyRecoveryPauseSignal(
  projectDir: string,
  recovery: Exclude<WorkflowRecoveryStatus, { status: "none" }>,
): void {
  const path = pauseSignalPath(projectDir);
  mkdirSync(join(projectDir, ".kota"), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({
      kind: "dirty-recovery",
      pausedAt: new Date().toISOString(),
      sourceWorkflow: recovery.sourceWorkflow,
      sourceRunId: recovery.sourceRunId,
      dirtyCheckout: recovery.dirtyCheckout,
      worktreeSummary: recovery.worktreeSummary,
      attempts: recovery.attempts,
      nextAction: recovery.nextAction,
    }, null, 2)}\n`,
    "utf8",
  );
}

export function clearWorkflowPauseSignal(projectDir: string): void {
  rmSync(pauseSignalPath(projectDir), { force: true });
}

function clearDirtyRecoveryPauseSignal(projectDir: string): void {
  const signal = parsePauseSignal(projectDir);
  if (signal?.kind === "dirty-recovery" || signal?.kind === "legacy-empty") {
    clearWorkflowPauseSignal(projectDir);
  }
}

export function reconcileWorkflowRecovery(input: {
  projectDir: string;
  workspaceDir?: string;
  store: RecoveryStoreAccess;
}): WorkflowRecoveryStatus {
  const recovery = input.store.getRecovery();
  if (!recovery) return { status: "none" };
  const dirtyCheckout = normalizeDirtyCheckout(recovery.dirtyCheckout);
  const worktreeDir = recoveryWorktreeDir({
    projectDir: input.projectDir,
    workspaceDir: input.workspaceDir,
    dirtyCheckout,
  });
  if (!worktreeDir) {
    return unavailableRecovery(
      recovery,
      dirtyCheckout,
      "workspace checkout path unavailable for dirty recovery",
    );
  }
  const worktree = getRepoWorktreeStatus(worktreeDir);

  if (!worktree.available) {
    return unavailableRecovery(recovery, dirtyCheckout, worktree.summary);
  }

  if (!worktree.dirty) {
    input.store.setRecovery(null);
    clearDirtyRecoveryPauseSignal(input.projectDir);
    return { status: "none", clearedStale: true };
  }

  return {
    status: "pending",
    ...recoveryProjection(
      {
        ...recovery,
        worktreeFingerprint: worktree.fingerprint,
        worktreeSummary: worktree.summary,
      },
      dirtyCheckout,
    ),
  };
}

export function resolveWorkflowDispatchPause(input: {
  projectDir: string;
  runtimePaused: boolean;
  recovery: WorkflowRecoveryStatus;
}): WorkflowDispatchPauseStatus {
  const signal = parsePauseSignal(input.projectDir);
  if (signal?.kind === "dirty-recovery" && input.recovery.status === "none") {
    clearWorkflowPauseSignal(input.projectDir);
    if (!input.runtimePaused) return { paused: false, kind: "none" };
  }
  if (
    (signal?.kind === "dirty-recovery" || signal?.kind === "legacy-empty") &&
    input.recovery.status !== "none"
  ) {
    return {
      paused: true,
      kind: "dirty-recovery",
      source: "signal",
      message: `Dirty recovery pause from ${input.recovery.sourceWorkflow} (${input.recovery.sourceRunId}).`,
      nextAction: input.recovery.nextAction,
      recovery: input.recovery,
    };
  }
  if (signal?.kind === "operator") {
    return {
      paused: true,
      kind: "operator",
      source: "signal",
      message: OPERATOR_PAUSE_MESSAGE,
      nextAction: "Run `kota workflow resume` to re-enable dispatch.",
    };
  }
  if (signal?.kind === "legacy-empty") {
    return {
      paused: true,
      kind: "operator",
      source: "signal",
      message: OPERATOR_PAUSE_MESSAGE,
      nextAction: "Run `kota workflow resume` to re-enable dispatch.",
    };
  }
  if (input.runtimePaused && input.recovery.status !== "none") {
    return {
      paused: true,
      kind: "dirty-recovery",
      source: "runtime",
      message: `Dirty recovery pause from ${input.recovery.sourceWorkflow} (${input.recovery.sourceRunId}).`,
      nextAction: input.recovery.nextAction,
      recovery: input.recovery,
    };
  }
  if (input.runtimePaused) {
    return {
      paused: true,
      kind: "runtime",
      source: "runtime",
      message: RUNTIME_PAUSE_MESSAGE,
      nextAction: "Inspect the running daemon before resuming dispatch.",
    };
  }
  return { paused: false, kind: "none" };
}
