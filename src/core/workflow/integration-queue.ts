import { execFileSync, spawnSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { RunSandbox } from "./run-sandbox.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowPostReconcileInvariantResult } from "./types.js";

export type IntegrationValidation =
  | { status: "passed"; evidence: readonly string[] }
  | { status: "failed"; evidence: readonly string[] };

export type IntegrationValidationInput = {
  workspaceDir: string;
  head: string;
  canonicalHead: string;
  signal: AbortSignal;
};

export type IntegrationRequest = {
  repositoryId: string;
  sandbox: RunSandbox;
  epoch: number;
  signal: AbortSignal;
  validate: (input: IntegrationValidationInput) => Promise<IntegrationValidation>;
  verifyPostReconcile?: (
    input: IntegrationValidationInput,
  ) => WorkflowPostReconcileInvariantResult;
  /** Persist the exact publication intent before the canonical ref moves. */
  beforePublish?: (input: {
    canonicalHead: string;
    publishedHead: string;
  }) => void | Promise<void>;
};

type IntegrationIdentity = {
  repositoryId: string;
  runId: string;
  workspaceDir: string;
  branch: string;
  targetBranch: string;
  writerHead: string;
  canonicalHead: string;
};

type ReconciledIntegration = IntegrationIdentity & {
  reconciledHead: string;
  validationEvidence: readonly string[];
};

type LockedIntegration = ReconciledIntegration & {
  resourceKey: string;
};

export type MergedIntegrationOutcome = LockedIntegration & {
  status: "merged";
  publishedHead: string;
};

export type StaleIntegrationOutcome = LockedIntegration & {
  status: "stale";
  observedCanonicalHead: string;
};

export type ConflictedIntegrationOutcome = IntegrationIdentity & {
  status: "conflicted";
  stoppedHead: string;
  conflictPaths: readonly string[];
  rebaseOutput: string;
};

export type ValidationFailedIntegrationOutcome =
  | (IntegrationIdentity & {
      status: "validation-failed";
      phase: "precondition";
      reason: "canonical-dirty" | "workspace-dirty";
      dirtyStatus: string;
    })
  | (IntegrationIdentity & {
      status: "validation-failed";
      phase: "precondition";
      reason: "canonical-target-mismatch";
      observedCanonicalBranch?: string;
    })
  | (ReconciledIntegration & {
      status: "validation-failed";
      phase: "validation";
      reason: "validator-rejected";
    })
  | (ReconciledIntegration & {
      status: "validation-failed";
      phase: "validation";
      reason: "workspace-dirty";
      dirtyStatus: string;
    })
  | (ReconciledIntegration & {
      status: "validation-failed";
      phase: "validation";
      reason: "workspace-head-moved";
      observedWorkspaceHead: string;
    })
  | (LockedIntegration & {
      status: "validation-failed";
      phase: "publication";
      reason: "canonical-dirty";
      dirtyStatus: string;
    })
  | (LockedIntegration & {
      status: "validation-failed";
      phase: "publication";
      reason: "canonical-target-mismatch";
      observedCanonicalBranch?: string;
    })
  | (LockedIntegration & {
      status: "validation-failed";
      phase: "publication";
      reason: "workspace-dirty";
      dirtyStatus: string;
    })
  | (LockedIntegration & {
      status: "validation-failed";
      phase: "publication";
      reason: "workspace-head-moved";
      observedWorkspaceHead: string;
    });

export type BusyIntegrationOutcome = LockedIntegration & {
  status: "busy";
};

export type InvariantFailedIntegrationOutcome = LockedIntegration & {
  status: "invariant-failed";
  reason: string;
};

export type IntegrationOutcome =
  | MergedIntegrationOutcome
  | StaleIntegrationOutcome
  | ConflictedIntegrationOutcome
  | ValidationFailedIntegrationOutcome
  | InvariantFailedIntegrationOutcome
  | BusyIntegrationOutcome;

const gitEnvironment = withProtectedGitBareRepositoryEnv();

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function runGit(cwd: string, args: readonly string[]): {
  ok: boolean;
  output: string;
} {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    ok: result.status === 0,
    output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"),
  };
}

function branchOrUndefined(cwd: string): string | undefined {
  const result = runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.ok && result.output !== "" ? result.output : undefined;
}

export class IntegrationQueue {
  constructor(
    private readonly projectDir: string,
    private readonly runState: RunStateDatabase,
  ) {}

  async integrate(input: IntegrationRequest): Promise<IntegrationOutcome> {
    input.signal.throwIfAborted();
    const { sandbox } = input;
    if (sandbox.repository !== "write") {
      throw new Error(`Run "${sandbox.runId}" does not have a writer branch`);
    }

    const writerHead = git(sandbox.workspaceDir, ["rev-parse", "HEAD"]);
    const canonicalHead = git(this.projectDir, ["rev-parse", "HEAD"]);
    const identity: IntegrationIdentity = {
      repositoryId: input.repositoryId,
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
    };
    const canonicalBranch = branchOrUndefined(this.projectDir);
    if (canonicalBranch !== sandbox.targetBranch) {
      return {
        ...identity,
        status: "validation-failed",
        phase: "precondition",
        reason: "canonical-target-mismatch",
        observedCanonicalBranch: canonicalBranch,
      };
    }
    const workspaceStatus = git(sandbox.workspaceDir, ["status", "--porcelain"]);
    if (workspaceStatus !== "") {
      return {
        ...identity,
        status: "validation-failed",
        phase: "precondition",
        reason: "workspace-dirty",
        dirtyStatus: workspaceStatus,
      };
    }
    const canonicalStatus = git(this.projectDir, ["status", "--porcelain"]);
    if (canonicalStatus !== "") {
      return {
        ...identity,
        status: "validation-failed",
        phase: "precondition",
        reason: "canonical-dirty",
        dirtyStatus: canonicalStatus,
      };
    }
    const rebase = runGit(sandbox.workspaceDir, ["rebase", canonicalHead]);
    if (!rebase.ok) {
      const conflictPaths = git(sandbox.workspaceDir, [
        "diff",
        "--name-only",
        "--diff-filter=U",
      ])
        .split("\n")
        .filter(Boolean);
      if (conflictPaths.length === 0) throw new Error(rebase.output);
      return {
        ...identity,
        status: "conflicted",
        stoppedHead: git(sandbox.workspaceDir, ["rev-parse", "HEAD"]),
        conflictPaths,
        rebaseOutput: rebase.output,
      };
    }
    const reconciledHead = git(sandbox.workspaceDir, ["rev-parse", "HEAD"]);
    const validation = await input.validate({
      workspaceDir: sandbox.workspaceDir,
      head: reconciledHead,
      canonicalHead,
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    const reconciled: ReconciledIntegration = {
      ...identity,
      reconciledHead,
      validationEvidence: validation.evidence,
    };
    const validatedWorkspaceStatus = git(sandbox.workspaceDir, [
      "status",
      "--porcelain",
    ]);
    if (validatedWorkspaceStatus !== "") {
      return {
        ...reconciled,
        status: "validation-failed",
        phase: "validation",
        reason: "workspace-dirty",
        dirtyStatus: validatedWorkspaceStatus,
      };
    }
    const observedWorkspaceHead = git(sandbox.workspaceDir, ["rev-parse", "HEAD"]);
    if (observedWorkspaceHead !== reconciledHead) {
      return {
        ...reconciled,
        status: "validation-failed",
        phase: "validation",
        reason: "workspace-head-moved",
        observedWorkspaceHead,
      };
    }
    if (validation.status === "failed") {
      return {
        ...reconciled,
        status: "validation-failed",
        phase: "validation",
        reason: "validator-rejected",
      };
    }

    const resourceKey = `repo:${input.repositoryId}:integration`;
    const acquired = this.runState.tryAcquireResource({
      runId: sandbox.runId,
      resourceKey,
      lifetime: "attempt",
      epoch: input.epoch,
      acquiredAt: new Date().toISOString(),
    });
    if (!acquired) {
      return {
        ...reconciled,
        status: "busy",
        resourceKey,
      };
    }

    const publication: LockedIntegration = { ...reconciled, resourceKey };
    try {
      input.signal.throwIfAborted();
      const observedCanonicalBranch = branchOrUndefined(this.projectDir);
      if (observedCanonicalBranch !== sandbox.targetBranch) {
        return {
          ...publication,
          status: "validation-failed",
          phase: "publication",
          reason: "canonical-target-mismatch",
          observedCanonicalBranch,
        };
      }
      const observedCanonicalHead = git(this.projectDir, ["rev-parse", "HEAD"]);
      if (observedCanonicalHead !== canonicalHead) {
        return {
          ...publication,
          status: "stale",
          observedCanonicalHead,
        };
      }
      const canonicalStatus = git(this.projectDir, ["status", "--porcelain"]);
      if (canonicalStatus !== "") {
        return {
          ...publication,
          status: "validation-failed",
          phase: "publication",
          reason: "canonical-dirty",
          dirtyStatus: canonicalStatus,
        };
      }
      input.signal.throwIfAborted();
      const invariant = input.verifyPostReconcile?.({
        workspaceDir: sandbox.workspaceDir,
        head: reconciledHead,
        canonicalHead: observedCanonicalHead,
        signal: input.signal,
      });
      input.signal.throwIfAborted();
      const publicationWorkspaceStatus = git(sandbox.workspaceDir, [
        "status",
        "--porcelain",
      ]);
      if (publicationWorkspaceStatus !== "") {
        return {
          ...publication,
          status: "validation-failed",
          phase: "publication",
          reason: "workspace-dirty",
          dirtyStatus: publicationWorkspaceStatus,
        };
      }
      const publicationWorkspaceHead = git(sandbox.workspaceDir, [
        "rev-parse",
        "HEAD",
      ]);
      if (publicationWorkspaceHead !== reconciledHead) {
        return {
          ...publication,
          status: "validation-failed",
          phase: "publication",
          reason: "workspace-head-moved",
          observedWorkspaceHead: publicationWorkspaceHead,
        };
      }
      const postInvariantCanonicalBranch = branchOrUndefined(this.projectDir);
      if (postInvariantCanonicalBranch !== sandbox.targetBranch) {
        return {
          ...publication,
          status: "validation-failed",
          phase: "publication",
          reason: "canonical-target-mismatch",
          observedCanonicalBranch: postInvariantCanonicalBranch,
        };
      }
      const postInvariantCanonicalHead = git(this.projectDir, ["rev-parse", "HEAD"]);
      if (postInvariantCanonicalHead !== observedCanonicalHead) {
        return {
          ...publication,
          status: "stale",
          observedCanonicalHead: postInvariantCanonicalHead,
        };
      }
      const postInvariantCanonicalStatus = git(this.projectDir, [
        "status",
        "--porcelain",
      ]);
      if (postInvariantCanonicalStatus !== "") {
        return {
          ...publication,
          status: "validation-failed",
          phase: "publication",
          reason: "canonical-dirty",
          dirtyStatus: postInvariantCanonicalStatus,
        };
      }
      if (invariant?.satisfied === false) {
        return {
          ...publication,
          status: "invariant-failed",
          reason: invariant.reason,
        };
      }
      input.signal.throwIfAborted();
      await input.beforePublish?.({
        canonicalHead: observedCanonicalHead,
        publishedHead: reconciledHead,
      });
      input.signal.throwIfAborted();
      git(this.projectDir, ["merge", "--ff-only", reconciledHead]);
      return {
        ...publication,
        status: "merged",
        publishedHead: git(this.projectDir, ["rev-parse", "HEAD"]),
      };
    } finally {
      this.runState.releaseResource(sandbox.runId, resourceKey, input.epoch);
    }
  }
}
