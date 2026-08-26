import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactSensitiveText } from "#core/evidence/policy.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { writeControlMonitorCoverageArtifactBestEffort } from "./control-monitor-coverage.js";
import {
  IntegrationQueue,
  type IntegrationValidation,
  type IntegrationValidationInput,
} from "./integration-queue.js";
import {
  AmbiguousExternalEffectError,
  createRunContext,
  type RunContext,
} from "./run-context.js";
import type { RunExecutionOutcome } from "./run-coordinator.js";
import { readWorkflowRunMetadataFile } from "./run-metadata.js";
import { RunResourceAllocator } from "./run-resources.js";
import type { RunSandbox } from "./run-sandbox.js";
import { RunSandboxManager } from "./run-sandbox.js";
import type { RunStateDatabase, StoredRun } from "./run-state-database.js";
import type { WorkflowPostReconcileInvariantResult } from "./types.js";
import {
  type WriterIntegrationEvidence,
  writeWriterIntegrationEvidence,
} from "./writer-integration-evidence.js";

export type WorkflowExecutionOutcome =
  | { kind: "completed"; commitMessage?: string }
  | { kind: "terminal"; state: "failed" | "cancelled"; error?: string }
  | Extract<RunExecutionOutcome, { kind: "suspended" }>;

export type WorkflowContextExecutor = (
  context: RunContext,
  run: StoredRun,
) => Promise<WorkflowExecutionOutcome>;

export type IntegrationContinuationIssue =
  | {
      kind: "conflict";
      fingerprint: string;
      conflictPaths: readonly string[];
    }
  | {
      kind: "validation";
      fingerprint: string;
      evidence: readonly string[];
    };

export type IntegrationContinuation = (
  context: RunContext,
  issue: IntegrationContinuationIssue,
) => Promise<void>;

export type RunLifecycleOptions = {
  store: RunStateDatabase;
  daemonEpoch: number;
  executeWorkflow: WorkflowContextExecutor;
  validate: (
    context: RunContext,
    input: IntegrationValidationInput,
  ) => Promise<IntegrationValidation>;
  verifyPostReconcile?: (
    context: RunContext,
    input: IntegrationValidationInput,
  ) => WorkflowPostReconcileInvariantResult;
  continueIntegration: IntegrationContinuation;
  now?: () => string;
  createSandboxManager?: (projectRoot: string) => RunSandboxManager;
  createIntegrationQueue?: (projectRoot: string) => IntegrationQueue;
  createResourceAllocator?: (store: RunStateDatabase) => RunResourceAllocator;
};

type IntegrationJournal = {
  contract: "run-lifecycle-v1";
  phase:
    | "preparing"
    | "pending"
    | "waiting"
    | "attention"
    | "publishing"
    | "merged";
  commitMessage: string;
  baseHead: string;
  targetBranch: string;
  fingerprints: string[];
  outcome?: Record<string, unknown>;
  publishedHead?: string;
  integratedFromHead?: string;
  publishedCommitSubject?: string | null;
  publishedCommitMessage?: string | null;
  changedPaths?: string[];
  completedAt?: string;
};

const gitEnvironment = withProtectedGitBareRepositoryEnv();

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: gitEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function runGit(cwd: string, args: readonly string[]): { ok: boolean; output: string } {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...gitEnvironment, GIT_EDITOR: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    ok: result.status === 0,
    output: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"),
  };
}

function isCommitAncestor(cwd: string, ancestor: string | undefined, descendant: string): boolean {
  if (ancestor === undefined) return false;
  return runGit(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]).ok;
}

function serializable(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function readJournal(value: Record<string, unknown> | undefined): IntegrationJournal | null {
  if (!value) return null;
  if (value.contract !== "run-lifecycle-v1") {
    throw new Error("Run has integration state owned by another lifecycle contract");
  }
  return value as IntegrationJournal;
}

function isRebaseActive(workspaceDir: string): boolean {
  const path = git(workspaceDir, ["rev-parse", "--git-path", "rebase-merge"]);
  return existsSync(path);
}

function conflictPaths(workspaceDir: string): string[] {
  return git(workspaceDir, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean);
}

function workspaceFingerprint(workspaceDir: string): string {
  const rebaseHead = runGit(workspaceDir, ["rev-parse", "REBASE_HEAD"]);
  const material = [
    git(workspaceDir, ["rev-parse", "HEAD"]),
    git(workspaceDir, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(workspaceDir, ["diff", "--binary"]),
    git(workspaceDir, ["diff", "--cached", "--binary"]),
    rebaseHead.ok ? rebaseHead.output : "",
  ].join("\0");
  return createHash("sha256").update(material).digest("hex");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lines(value: string): string[] {
  return value.split("\n").filter(Boolean).sort();
}

export class RunLifecycle {
  private readonly now: () => string;
  private readonly sandboxManager: (projectRoot: string) => RunSandboxManager;
  private readonly integrationQueue: (projectRoot: string) => IntegrationQueue;
  private readonly resourceAllocator: RunResourceAllocator;

  constructor(private readonly options: RunLifecycleOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.sandboxManager =
      options.createSandboxManager ?? ((root) => new RunSandboxManager(root));
    this.integrationQueue =
      options.createIntegrationQueue ?? ((root) => new IntegrationQueue(root, options.store));
    this.resourceAllocator =
      options.createResourceAllocator?.(options.store) ??
      new RunResourceAllocator(options.store, {
        portStart: 30_000,
        portEnd: 49_999,
        portRangeSize: 20,
      });
  }

  async execute(run: StoredRun, signal: AbortSignal): Promise<RunExecutionOutcome> {
    const projectRoot = this.options.store.getProjectRoot(run.projectId);
    if (!projectRoot) {
      return { kind: "terminal", state: "failed", error: `Unknown project "${run.projectId}"` };
    }
    const manager = this.sandboxManager(projectRoot);
    let sandbox: RunSandbox | undefined;
    try {
      if (run.sandbox) {
        try {
          sandbox = manager.adopt(run.sandbox);
        } catch {
          const reconciled = manager.reconcile(run.id, run.repository);
          if (reconciled.status === "removed" || reconciled.status === "absent") {
            const recovered = this.finishIntegratedWithoutSandbox(run, projectRoot);
            if (recovered) return recovered;
          }
          if (reconciled.status !== "active") throw new Error(`Run "${run.id}" sandbox is not recoverable`);
          sandbox = reconciled.sandbox;
        }
      } else {
        const reconciled = manager.reconcile(run.id, run.repository);
        if (reconciled.status === "removed" || reconciled.status === "absent") {
          const recovered = this.finishIntegratedWithoutSandbox(run, projectRoot);
          if (recovered) return recovered;
        }
        sandbox =
          reconciled.status === "active"
            ? reconciled.sandbox
            : manager.create({ runId: run.id, repository: run.repository });
      }
      if (!run.sandbox) {
        this.options.store.setSandbox(run.id, this.options.daemonEpoch, sandbox);
      }
      const resources = await this.resourceAllocator.allocate(
        run,
        sandbox,
        this.options.daemonEpoch,
      );
      const context = createRunContext({
        runId: run.id,
        attempt: run.attempt,
        daemonEpoch: this.options.daemonEpoch,
        projectId: run.projectId,
        projectRoot,
        workflow: run.workflow,
        trigger: run.trigger,
        sandbox,
        resources,
        signal,
        store: this.options.store,
        now: this.now,
      });
      signal.throwIfAborted();

      if (sandbox.repository === "write" && run.integration) {
        return await this.finalizeWriter(context, manager, readJournal(run.integration));
      }

      const outcome = await this.options.executeWorkflow(context, run);
      signal.throwIfAborted();
      if (outcome.kind !== "completed") {
        if (outcome.kind === "terminal") {
          const cleanup = this.cleanupSandbox(manager, sandbox, run.id);
          if (cleanup) return cleanup;
        }
        return outcome;
      }
      if (sandbox.repository !== "write") {
        return (
          this.cleanupSandbox(manager, sandbox, run.id) ??
          { kind: "terminal", state: "succeeded" }
        );
      }

      const journal: IntegrationJournal = {
        contract: "run-lifecycle-v1",
        phase: "preparing",
        commitMessage: outcome.commitMessage ?? `${run.workflow}: ${run.id}`,
        baseHead: sandbox.baseCommit,
        targetBranch: sandbox.targetBranch,
        fingerprints: [],
      };
      return await this.finalizeWriter(context, manager, journal);
    } catch (error) {
      const journal = readJournal(this.options.store.getRun(run.id)?.integration);
      if (sandbox?.repository === "write" && journal?.phase === "publishing") {
        return this.attention("integration-publication-interrupted", [
          errorMessage(error),
        ]);
      }
      if (sandbox) {
        const cleanup = this.cleanupSandbox(manager, sandbox, run.id);
        if (cleanup) return cleanup;
      }
      if (error instanceof AmbiguousExternalEffectError) {
        return this.attention("external-effect-ambiguous", [error.effectKey]);
      }
      if (signal.aborted) {
        return { kind: "terminal", state: "cancelled", error: errorMessage(error) };
      }
      return { kind: "terminal", state: "failed", error: errorMessage(error) };
    }
  }

  private async finalizeWriter(
    context: RunContext,
    manager: RunSandboxManager,
    persisted: IntegrationJournal | null,
  ): Promise<RunExecutionOutcome> {
    const sandbox = context.sandbox as Extract<RunSandbox, { repository: "write" }>;
    if (!persisted) throw new Error("Writer finalization requires a durable intent");
    let journal = persisted;
    this.options.store.beginIntegration(
      context.run.id,
      context.run.daemonEpoch,
      serializable(journal),
    );
    if (journal.phase === "merged") return this.cleanupMerged(context, manager, sandbox);
    if (journal.phase === "publishing") {
      const canonicalHead = git(context.project.root, ["rev-parse", "HEAD"]);
      if (isCommitAncestor(context.project.root, journal.publishedHead, canonicalHead)) {
        journal = { ...journal, phase: "merged" };
        this.persist(context, journal);
        return this.cleanupMerged(context, manager, sandbox);
      }
      if (canonicalHead !== journal.integratedFromHead) {
        return this.attention("integration-publication-ambiguous", [
          canonicalHead,
          journal.integratedFromHead ?? "missing-integrated-from-head",
          journal.publishedHead ?? "missing-published-head",
        ]);
      }
    }

    if (journal.phase === "preparing") {
      this.commitChanges(sandbox.workspaceDir, journal.commitMessage);
      journal = { ...journal, phase: "pending" };
      this.persist(context, journal);
    }

    if (isRebaseActive(sandbox.workspaceDir)) {
      const resolution = await this.resolveConflicts(context, journal);
      if (resolution.kind === "suspended") return resolution;
      journal = resolution.journal;
    }

    const queue = this.integrationQueue(context.project.root);
    while (true) {
      if (context.signal.aborted) {
        return { kind: "terminal", state: "cancelled" };
      }
      const outcome = await queue.integrate({
        repositoryId: context.project.id,
        sandbox,
        epoch: context.run.daemonEpoch,
        signal: context.signal,
        validate: (input) => this.options.validate(context, input),
        verifyPostReconcile: this.options.verifyPostReconcile
          ? (input) => this.options.verifyPostReconcile!(context, input)
          : undefined,
        beforePublish: ({ canonicalHead, publishedHead }) => {
          journal = this.completeIntegrationJournal(
            journal,
            sandbox,
            canonicalHead,
            publishedHead,
            lines(
              git(sandbox.workspaceDir, [
                "diff",
                "--name-only",
                `${canonicalHead}..${publishedHead}`,
                "--",
              ]),
            ),
            "publishing",
          );
          this.persist(context, journal);
        },
      });
      journal = { ...journal, outcome: serializable(outcome) };
      this.persist(context, journal);

      if (outcome.status === "merged") {
        journal = { ...journal, phase: "merged" };
        this.persist(context, journal);
        return this.cleanupMerged(context, manager, sandbox);
      }
      if (outcome.status === "busy" || outcome.status === "stale") {
        journal = { ...journal, phase: "waiting" };
        this.persist(context, journal);
        return {
          kind: "suspended",
          state: "waiting",
          wait: { reason: `integration-${outcome.status}` },
          resumeAt: new Date(Date.parse(this.now()) + 1_000).toISOString(),
        };
      }
      if (outcome.status === "conflicted") {
        const resolution = await this.resolveConflicts(context, journal);
        if (resolution.kind === "suspended") return resolution;
        journal = resolution.journal;
        continue;
      }
      if (outcome.status === "invariant-failed") {
        return this.attention("integration-invariant-failed", [outcome.reason]);
      }
      if (outcome.phase !== "validation" || outcome.reason !== "validator-rejected") {
        return this.attention(`integration-${outcome.reason}`, []);
      }
      const fingerprint = workspaceFingerprint(sandbox.workspaceDir);
      if (journal.fingerprints.includes(fingerprint)) {
        return this.attention("integration-no-progress", [fingerprint]);
      }
      await this.options.continueIntegration(context, {
        kind: "validation",
        fingerprint,
        evidence: outcome.validationEvidence,
      });
      context.signal.throwIfAborted();
      const changed = workspaceFingerprint(sandbox.workspaceDir);
      if (changed === fingerprint) {
        return this.attention("integration-no-progress", [fingerprint]);
      }
      this.commitChanges(sandbox.workspaceDir, `${journal.commitMessage} (validation repair)`);
      journal = {
        ...journal,
        phase: "pending",
        fingerprints: [...journal.fingerprints, fingerprint],
      };
      this.persist(context, journal);
    }
  }

  private async resolveConflicts(
    context: RunContext,
    initial: IntegrationJournal,
  ): Promise<{ kind: "ready"; journal: IntegrationJournal } | Extract<RunExecutionOutcome, { kind: "suspended" }>> {
    const workspaceDir = context.sandbox.workspaceDir;
    let journal = initial;
    while (isRebaseActive(workspaceDir)) {
      const paths = conflictPaths(workspaceDir);
      if (paths.length === 0) {
        return this.attention("rebase-stopped-without-conflicts", []);
      }
      const fingerprint = workspaceFingerprint(workspaceDir);
      if (journal.fingerprints.includes(fingerprint)) {
        return this.attention("integration-no-progress", [fingerprint]);
      }
      await this.options.continueIntegration(context, {
        kind: "conflict",
        fingerprint,
        conflictPaths: paths,
      });
      context.signal.throwIfAborted();
      if (workspaceFingerprint(workspaceDir) === fingerprint) {
        return this.attention("integration-no-progress", [fingerprint]);
      }
      git(workspaceDir, ["add", "-A"]);
      const continued = runGit(workspaceDir, ["rebase", "--continue"]);
      if (!continued.ok && conflictPaths(workspaceDir).length === 0) {
        throw new Error(continued.output);
      }
      journal = {
        ...journal,
        phase: "pending",
        fingerprints: [...journal.fingerprints, fingerprint],
      };
      this.persist(context, journal);
    }
    return { kind: "ready", journal };
  }

  private commitChanges(workspaceDir: string, message: string): string {
    git(workspaceDir, ["add", "-A"]);
    if (runGit(workspaceDir, ["diff", "--cached", "--quiet"]).ok) {
      return git(workspaceDir, ["rev-parse", "HEAD"]);
    }
    git(workspaceDir, ["commit", "-m", message]);
    return git(workspaceDir, ["rev-parse", "HEAD"]);
  }

  private cleanupMerged(
    context: RunContext,
    manager: RunSandboxManager,
    sandbox: Extract<RunSandbox, { repository: "write" }>,
  ): RunExecutionOutcome {
    const run = this.options.store.getRun(context.run.id);
    const journal = readJournal(run?.integration);
    if (!run || !journal) {
      return this.attention("integration-evidence-state-missing", []);
    }
    const evidence = this.publishIntegrationEvidence(
      run,
      context.project.root,
      journal,
    );
    if (evidence) return evidence;
    const cleanup = manager.cleanup(sandbox);
    if (!cleanup.cleaned) {
      return this.attention("integrated-sandbox-cleanup-blocked", cleanup.blockers);
    }
    this.options.store.clearSandbox(context.run.id, context.run.daemonEpoch);
    return { kind: "terminal", state: "succeeded" };
  }

  private cleanupSandbox(
    manager: RunSandboxManager,
    sandbox: RunSandbox,
    runId: string,
  ): Extract<RunExecutionOutcome, { kind: "suspended" }> | null {
    const cleanup = manager.cleanup(sandbox);
    if (!cleanup.cleaned) return this.attention("sandbox-cleanup-blocked", cleanup.blockers);
    this.options.store.clearSandbox(runId, this.options.daemonEpoch);
    return null;
  }

  private finishIntegratedWithoutSandbox(
    run: StoredRun,
    projectRoot: string,
  ): RunExecutionOutcome | null {
    let journal = readJournal(run.integration);
    if (journal?.phase === "publishing") {
      const canonicalHead = git(projectRoot, ["rev-parse", "HEAD"]);
      if (isCommitAncestor(projectRoot, journal.publishedHead, canonicalHead)) {
        journal = { ...journal, phase: "merged" };
        this.options.store.updateIntegration(
          run.id,
          this.options.daemonEpoch,
          serializable(journal),
        );
      } else {
        return this.attention(
          canonicalHead === journal.integratedFromHead
            ? "integrated-sandbox-missing"
            : "integration-publication-ambiguous",
          [
            canonicalHead,
            journal.integratedFromHead ?? "missing-integrated-from-head",
            journal.publishedHead ?? "missing-published-head",
          ],
        );
      }
    }
    if (journal?.phase !== "merged") return null;
    const evidence = this.publishIntegrationEvidence(run, projectRoot, journal);
    if (evidence) return evidence;
    this.options.store.clearSandbox(run.id, this.options.daemonEpoch);
    return { kind: "terminal", state: "succeeded" };
  }

  private persist(context: RunContext, journal: IntegrationJournal): void {
    this.options.store.updateIntegration(
      context.run.id,
      context.run.daemonEpoch,
      serializable(journal),
    );
  }

  private completeIntegrationJournal(
    journal: IntegrationJournal,
    sandbox: Extract<RunSandbox, { repository: "write" }>,
    integratedFromHead: string,
    publishedHead: string,
    changedPaths: string[],
    phase: "publishing" | "merged" = "merged",
  ): IntegrationJournal {
    const hasWriterChanges = changedPaths.length > 0;
    return {
      ...journal,
      phase,
      baseHead: sandbox.baseCommit,
      targetBranch: sandbox.targetBranch,
      integratedFromHead,
      publishedHead,
      publishedCommitSubject: hasWriterChanges
        ? git(sandbox.workspaceDir, ["show", "-s", "--format=%s", publishedHead])
        : null,
      publishedCommitMessage: hasWriterChanges
        ? git(sandbox.workspaceDir, ["show", "-s", "--format=%B", publishedHead]).trim()
        : null,
      changedPaths,
      completedAt: this.now(),
    };
  }

  private publishIntegrationEvidence(
    run: StoredRun,
    projectRoot: string,
    journal: IntegrationJournal,
  ): Extract<RunExecutionOutcome, { kind: "suspended" }> | null {
    if (
      journal.phase !== "merged" ||
      journal.publishedHead === undefined ||
      journal.integratedFromHead === undefined ||
      journal.changedPaths === undefined ||
      journal.completedAt === undefined
    ) {
      return this.attention("integration-evidence-state-incomplete", []);
    }
    const evidence: WriterIntegrationEvidence = {
      version: 1,
      runId: run.id,
      workflow: run.workflow,
      projectId: run.projectId,
      targetBranch: journal.targetBranch,
      baseHead: journal.baseHead,
      integratedFromHead: journal.integratedFromHead,
      publishedHead: journal.publishedHead,
      commitSubject: journal.publishedCommitSubject ?? null,
      commitMessage: journal.publishedCommitMessage ?? null,
      changedPaths: [...journal.changedPaths].sort(),
      completedAt: journal.completedAt,
    };
    try {
      writeWriterIntegrationEvidence(projectRoot, evidence);
    } catch (error) {
      return this.attention("integration-evidence-write-failed", [
        errorMessage(error),
      ]);
    }
    this.refreshWriterControlCoverage(projectRoot, evidence);
    return null;
  }

  private refreshWriterControlCoverage(
    projectRoot: string,
    evidence: WriterIntegrationEvidence,
  ): void {
    const runDirPath = join(projectRoot, ".kota", "runs", evidence.runId);
    try {
      const metadata = readWorkflowRunMetadataFile(
        join(runDirPath, "metadata.json"),
      );
      if (metadata === null) return;
      writeControlMonitorCoverageArtifactBestEffort({
        projectDir: projectRoot,
        runDirPath,
        metadata,
        headSha: evidence.publishedHead,
        errorArtifact: "control-monitor-coverage-error.txt",
      });
    } catch (error) {
      writeFileSync(
        join(runDirPath, "control-monitor-coverage-error.txt"),
        redactSensitiveText(errorMessage(error)),
        "utf8",
      );
    }
  }

  private attention(reason: string, evidence: readonly string[]): Extract<RunExecutionOutcome, { kind: "suspended" }> {
    return {
      kind: "suspended",
      state: "needs_attention",
      wait: { reason, evidence: [...evidence] },
      error: reason,
    };
  }
}
