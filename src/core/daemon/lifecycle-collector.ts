import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setImmediate as yieldToControl } from "node:timers/promises";
import { promisify } from "node:util";
import {
  buildEvidencePrunedReference,
  resolveEvidenceRetention,
} from "#core/evidence/policy.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import {
  readWorkflowRunMetadataFile,
  type StoredWorkflowRunDirectoryId,
  WorkflowRunMetadataAuthorityError,
  workflowRunMetadataTerminalIds,
} from "#core/workflow/run-metadata.js";
import { allocationName } from "#core/workflow/run-sandbox.js";
import type { StoredRun } from "#core/workflow/run-state-types.js";
import { PRUNED_RUN_REFERENCES_FILE } from "#core/workflow/run-store-retention.js";
import { commitJournal, inspectRunMetadataOperation, type LifecycleRunMetadata, prepareJournalOperation } from "./lifecycle-collector-io.js";
import type {
  LifecycleCandidate,
  LifecycleCandidateDecision,
  LifecycleCollectorDeps,
  LifecycleStatusOptions,
  LifecycleStatusReport,
  LifecycleStoreName,
  LifecycleSweepOptions,
  LifecycleSweepReport,
  StoreReclamationSummary,
} from "./lifecycle-collector-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_IDLE_TTL_MS = 5 * 60 * 1000;
const RESOLVED_APPROVAL_RETENTION_MS = 14 * DAY_MS;
const RESOLVED_DEAD_LETTER_RETENTION_MS = 14 * DAY_MS;
const DELIVERED_PUBLICATION_RETENTION_MS = 14 * DAY_MS;
const TERMINAL_RUN_DB_RETENTION_MS = 30 * DAY_MS;

const execFileAsync = promisify(execFile);

async function safeGetDirectorySize(dir: string): Promise<number> {
  let total = 0;
  try {
    // Do not follow links, including a substituted root.
    if (!(await lstat(dir)).isDirectory()) return 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      try {
        if (entry.isDirectory()) total += await safeGetDirectorySize(path);
        else if (entry.isFile()) total += (await lstat(path)).size;
      } catch { /* Unreadable or transient files have no size estimate. */ }
    }
  } catch { /* Unreadable directories have no size estimate. */ }
  return total;
}

async function safeGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd, env: withProtectedGitBareRepositoryEnv(), encoding: "utf8",
    });
    return stdout.trim();
  } catch { return null; }
}

async function isGitRepository(dir: string): Promise<boolean> {
  return await safeGit(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

async function isWorktreeDirty(dir: string): Promise<boolean> {
  const status = await safeGit(dir, ["status", "--porcelain"]);
  return status === null || status.length > 0;
}

async function isCommitIntegrated(root: string, commit: string, target = "HEAD"): Promise<boolean> {
  return await safeGit(root, ["merge-base", "--is-ancestor", commit, target]) !== null;
}

async function listKotaRunBranches(root: string): Promise<string[]> {
  const output = await safeGit(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/kota/run/*"]);
  return output ? output.split("\n").map(b => b.trim()).filter(Boolean) : [];
}

async function deleteGitBranch(root: string, branch: string): Promise<boolean> {
  return await safeGit(root, ["branch", "-D", branch]) !== null;
}

async function removeGitWorktree(root: string, dir: string): Promise<boolean> {
  // Git must recheck dirty work at removal; never force through a concurrent edit.
  return await safeGit(root, ["worktree", "remove", dir]) !== null;
}

async function listTrackedRunIds(scopeRoot: string, runsDir: string): Promise<Set<string>> {
  const runsPath = relative(scopeRoot, runsDir).split("\\").join("/");
  if (!runsPath || runsPath.startsWith("..")) return new Set();
  let output: string;
  try {
    ({ stdout: output } = await execFileAsync("git", ["ls-files", "--", runsPath], {
      cwd: scopeRoot, encoding: "utf8", env: withProtectedGitBareRepositoryEnv({ ...process.env, LC_ALL: "C" }),
    }));
  } catch (error) {
    // Directory-backed non-code scopes legitimately have no tracked evidence.
    // Other failures (permissions, corrupt index, missing Git) cannot authorize deletion.
    if (error instanceof Error && "code" in error && error.code === 128 &&
        "stderr" in error && typeof error.stderr === "string" && error.stderr.startsWith("fatal: not a git repository")) return new Set();
    throw new Error(`Cannot establish tracked run evidence in ${scopeRoot}`, { cause: error });
  }
  const prefix = `${runsPath.replace(/\/+$/, "")}/`;
  return new Set(output.split("\n").filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length).split("/", 1)[0]).filter(Boolean));
}

async function removeCollectedDirectory(path: string, runtimeDir: string): Promise<void> {
  // Detach before yielding: a newly admitted run can safely recreate its own
  // path while recursive removal proceeds. A crash leaves an ordinary orphan
  // in the existing runtime namespace for the next sweep to reclaim.
  mkdirSync(runtimeDir, { recursive: true });
  const detached = join(runtimeDir, `lifecycle-reclaim-${randomUUID()}`);
  renameSync(path, detached);
  await rm(detached, { recursive: true, force: true });
}

function isLiveRun(run: StoredRun): boolean {
  return !["succeeded", "failed", "cancelled"].includes(run.state);
}

function resolveRunArtifactDeletionTarget(
  runsDir: string,
  directoryId: StoredWorkflowRunDirectoryId,
): string | null {
  let validatedDirectoryId: string;
  try {
    validatedDirectoryId = validateWorkflowRunId(
      directoryId,
      "Lifecycle run artifact directory",
    );
  } catch {
    return null;
  }

  const resolvedRunsDir = resolve(runsDir);
  const resolvedTarget = resolve(resolvedRunsDir, validatedDirectoryId);
  const child = relative(resolvedRunsDir, resolvedTarget);
  if (
    child !== validatedDirectoryId ||
    isAbsolute(child) ||
    dirname(resolvedTarget) !== resolvedRunsDir
  ) {
    return null;
  }
  return resolvedTarget;
}

export class LifecycleCollector {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<LifecycleSweepReport>>();
  private closed = false;

  /** Drain maintenance before the daemon releases its stores. */
  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
  }

  constructor(private readonly deps: LifecycleCollectorDeps) {}

  async status(options: LifecycleStatusOptions = {}): Promise<LifecycleStatusReport> {
    const sweepReport = await this.sweep({
      dryRun: true,
      scopeId: options.scopeId,
      now: options.now,
    });
    const byDecision: Record<LifecycleCandidateDecision, number> = {
      keep: 0,
      compact: 0,
      delete: 0,
      needs_attention: 0,
    };
    let estimatedReclaimableBytes = 0;
    for (const candidate of sweepReport.candidates) {
      byDecision[candidate.decision] += 1;
      if (candidate.decision === "compact" || candidate.decision === "delete") {
        estimatedReclaimableBytes += candidate.estimatedBytes;
      }
    }
    return {
      candidates: sweepReport.candidates,
      summary: {
        totalCandidates: sweepReport.candidates.length,
        byDecision,
        estimatedReclaimableBytes,
      },
      completedAt: sweepReport.completedAt,
    };
  }

  sweep(options: LifecycleSweepOptions = {}): Promise<LifecycleSweepReport> {
    if (this.closed) return Promise.reject(new Error("Lifecycle collector is closed"));
    const key = JSON.stringify([options.dryRun ?? false, options.scopeId, options.targetRunId, options.now]);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const sweep = this.tail.then(() => this.collect(options));
    this.tail = sweep.catch(() => {});
    this.pending.set(key, sweep);
    void sweep.finally(() => this.pending.delete(key)).catch(() => {});
    return sweep;
  }

  private runIsProtected(scopeId: string, runId: string): boolean {
    const current = this.deps.runState.getRun(runId);
    return (current !== null && (current.scopeId !== scopeId || isLiveRun(current) || current.sandbox !== undefined)) ||
      this.deps.runState.listPendingPublicationHeads().some(p => p.runId === runId);
  }

  private async stage(name: string, operation: () => void | Promise<void>): Promise<void> {
    await yieldToControl();
    const started = performance.now();
    try { await operation(); }
    finally { this.deps.log?.(`Lifecycle ${name}: ${(performance.now() - started).toFixed(1)}ms`); }
  }

  private async collect(options: LifecycleSweepOptions): Promise<LifecycleSweepReport> {
    const nowDate =
      options.now instanceof Date
        ? options.now
        : typeof options.now === "number"
          ? new Date(options.now)
          : this.deps.now
            ? this.deps.now()
            : new Date();
    const nowMs = nowDate.getTime();
    const dryRun = options.dryRun ?? false;
    const targetScopeId = options.scopeId;
    const targetRunId = options.targetRunId;

    const candidates: LifecycleCandidate[] = [];
    const reclaimedByStore: Record<string, StoreReclamationSummary> = {};

    const recordReclaimed = (store: LifecycleStoreName, count: number, bytes: number) => {
      if (count <= 0 && bytes <= 0) return;
      const existing = reclaimedByStore[store] ?? { count: 0, reclaimedBytes: 0 };
      existing.count += count;
      existing.reclaimedBytes += bytes;
      reclaimedByStore[store] = existing;
    };

    const scopes = this.deps.scopeRegistry
      .list()
      .filter((s) => targetScopeId === undefined || s.scopeId === targetScopeId);

    // 1. Sandboxes
    await this.stage("Sandboxes", () => this.collectSandboxes({
      scopes,
      nowMs,
      targetRunId,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 2. Git Branches
    await this.stage("GitBranches", () => this.collectGitBranches({
      scopes,
      targetRunId,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 3. Processes
    if (!targetRunId) await this.stage("Processes", () => this.collectProcesses({
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 4. Sessions
    if (!targetRunId) await this.stage("Sessions", () => this.collectSessions({
      targetScopeId,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 5. Chat Bindings
    if (!targetRunId) await this.stage("ChatBindings", () => this.collectChatBindings({
      targetScopeId,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 6. Owner Records
    if (!targetRunId) await this.stage("OwnerRecords", () => this.collectOwnerRecords({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 7. Idempotency Records
    if (!targetRunId) await this.stage("Idempotency", () => this.collectIdempotency({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 8. Temporary Payloads
    if (!targetRunId) await this.stage("TemporaryPayloads", () => this.collectTemporaryPayloads({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 9. Run Artifacts
    await this.stage("RunArtifacts", () => this.collectRunArtifacts({
      scopes,
      nowMs,
      targetRunId,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 10. Event Journal
    if (!targetRunId) await this.stage("EventJournal", () => this.collectEventJournal({
      nowMs,
      nowDate,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 11. Dead Letters
    if (!targetRunId) await this.stage("DeadLetters", () => this.collectDeadLetters({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    // 12. RunStateDatabase SQLite
    if (!targetRunId) await this.stage("RunStateDatabase", () => this.collectRunStateDatabase({
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    }));

    let reclaimedCount = 0;
    let reclaimedBytes = 0;
    for (const summary of Object.values(reclaimedByStore)) {
      reclaimedCount += summary.count;
      reclaimedBytes += summary.reclaimedBytes;
    }

    return {
      dryRun,
      candidates,
      reclaimedByStore,
      reclaimedCount,
      reclaimedBytes,
      completedAt: nowDate.toISOString(),
    };
  }

  private async collectSandboxes(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    targetRunId?: string;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    for (const scope of ctx.scopes) {
      const runtimeDir = join(scope.scopeRoot, ".kota", "runtime");
      if (!existsSync(runtimeDir)) continue;

      const allocationToRun = new Map(this.deps.runState.listRunStates(scope.scopeId)
        .map(run => [allocationName(run.id), run.id]));

      let entries: string[] = [];
      try {
        entries = readdirSync(runtimeDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry === "worktrees" || entry === "tmp" || entry.endsWith(".tmp")) continue;
        const rootDir = join(runtimeDir, entry);
        await yieldToControl();
        const stat = lstatSync(rootDir, { throwIfNoEntry: false });
        if (!stat?.isDirectory()) continue;

        const runId = allocationToRun.get(entry);
        const matchingRun = runId ? this.deps.runState.getRun(runId) : null;
        if (ctx.targetRunId && entry !== allocationName(ctx.targetRunId)) {
          continue;
        }

        if (matchingRun) {
          const finishedAtMs = matchingRun.finishedAt
            ? new Date(matchingRun.finishedAt).getTime()
            : matchingRun.startedAt
              ? new Date(matchingRun.startedAt).getTime()
              : new Date(matchingRun.admittedAt).getTime();
          const age = Math.max(0, ctx.nowMs - finishedAtMs);
          const isActive = this.runIsProtected(scope.scopeId, matchingRun.id);

          if (isActive) {
            ctx.candidates.push({
              candidate: rootDir,
              store: "sandboxes",
              decision: "keep",
              reason: "active-run-sandbox",
              age,
              owner: matchingRun.id,
              estimatedBytes: 0,
            });
            continue;
          }

          const rootBytes = await safeGetDirectorySize(rootDir);
          if (this.runIsProtected(scope.scopeId, matchingRun.id)) continue;

          // Terminal run sandbox
          if (matchingRun.repository === "none") {
            ctx.candidates.push({
              candidate: rootDir,
              store: "sandboxes",
              decision: "delete",
              reason: "terminal-none-sandbox",
              age,
              owner: matchingRun.id,
              estimatedBytes: rootBytes,
            });
            if (!ctx.dryRun) {
              await removeCollectedDirectory(rootDir, runtimeDir);
              ctx.recordReclaimed("sandboxes", 1, rootBytes);
            }
          } else {
            // "read" or "write" repo sandbox
            const worktreeDir = join(runtimeDir, "worktrees", entry);
            const worktreeExists = existsSync(worktreeDir);
            const worktreeBytes = worktreeExists ? await safeGetDirectorySize(worktreeDir) : 0;
            const totalBytes = rootBytes + worktreeBytes;

            if (worktreeExists) {
              if (await isWorktreeDirty(worktreeDir)) {
                ctx.candidates.push({
                  candidate: worktreeDir,
                  store: "sandboxes",
                  decision: "needs_attention",
                  reason: "workspace-dirty",
                  age,
                  owner: matchingRun.id,
                  estimatedBytes: totalBytes,
                  remediation: `Inspect and resolve uncommitted changes in worktree ${worktreeDir}`,
                });
                continue;
              }

              if (matchingRun.repository === "write") {
                const branchName = `kota/run/${entry}`;
                const integrated = await isCommitIntegrated(scope.scopeRoot, branchName, "HEAD");
                if (!integrated) {
                  ctx.candidates.push({
                    candidate: worktreeDir,
                    store: "sandboxes",
                    decision: "needs_attention",
                    reason: "commit-not-integrated",
                    age,
                    owner: matchingRun.id,
                    estimatedBytes: totalBytes,
                    remediation: `Inspect unintegrated worktree ${worktreeDir} on branch ${branchName}`,
                  });
                  continue;
                }
              }

              ctx.candidates.push({
                candidate: worktreeDir,
                store: "sandboxes",
                decision: "delete",
                reason:
                  matchingRun.repository === "write"
                    ? "terminal-writer-sandbox-integrated"
                    : "terminal-read-sandbox",
                age,
                owner: matchingRun.id,
                estimatedBytes: totalBytes,
              });

              if (!ctx.dryRun) {
                if (this.runIsProtected(scope.scopeId, matchingRun.id)) continue;
                if (!(await removeGitWorktree(scope.scopeRoot, worktreeDir))) continue;
                if (this.runIsProtected(scope.scopeId, matchingRun.id)) continue;
                if (matchingRun.repository === "write") {
                  await deleteGitBranch(scope.scopeRoot, `kota/run/${entry}`);
                }
                if (this.runIsProtected(scope.scopeId, matchingRun.id)) continue;
                await removeCollectedDirectory(rootDir, runtimeDir);
                ctx.recordReclaimed("sandboxes", 1, totalBytes);
              }
            } else {
              // Worktree missing, reclaim orphaned runtime root
              ctx.candidates.push({
                candidate: rootDir,
                store: "sandboxes",
                decision: "delete",
                reason: "terminal-sandbox-orphaned-root",
                age,
                owner: matchingRun.id,
                estimatedBytes: rootBytes,
              });
              if (!ctx.dryRun) {
                if (this.runIsProtected(scope.scopeId, matchingRun.id)) continue;
                await removeCollectedDirectory(rootDir, runtimeDir);
                ctx.recordReclaimed("sandboxes", 1, rootBytes);
              }
            }
          }
        } else {
          // Orphaned runtime directory with no matching run
          const age = Math.max(0, ctx.nowMs - (stat?.mtimeMs ?? ctx.nowMs));
          const rootBytes = await safeGetDirectorySize(rootDir);
          ctx.candidates.push({
            candidate: rootDir,
            store: "sandboxes",
            decision: "delete",
            reason: "orphaned-sandbox",
            age,
            owner: entry,
            estimatedBytes: rootBytes,
          });
          if (!ctx.dryRun) {
            if (this.deps.runState.listRunStates(scope.scopeId).some(run => allocationName(run.id) === entry)) continue;
            await removeCollectedDirectory(rootDir, runtimeDir);
            ctx.recordReclaimed("sandboxes", 1, rootBytes);
          }
        }
      }
    }
  }

  private async collectGitBranches(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    targetRunId?: string;
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    for (const scope of ctx.scopes) {
      if (!(await isGitRepository(scope.scopeRoot))) continue;

      const allocationToRun = new Map(this.deps.runState.listRunStates(scope.scopeId)
        .map(run => [allocationName(run.id), run.id]));

      const branches = await listKotaRunBranches(scope.scopeRoot);
      for (const branch of branches) {
        const allocation = branch.replace(/^kota\/run\//, "");
        if (ctx.targetRunId && allocation !== allocationName(ctx.targetRunId)) continue;
        const runId = allocationToRun.get(allocation);
        const matchingRun = runId ? this.deps.runState.getRun(runId) : null;

        if (matchingRun) {
          const isActive = this.runIsProtected(scope.scopeId, matchingRun.id);

          if (isActive) {
            ctx.candidates.push({
              candidate: branch,
              store: "git-branches",
              decision: "keep",
              reason: "active-run-branch",
              age: 0,
              owner: matchingRun.id,
              estimatedBytes: 0,
            });
            continue;
          }
        }

        const integrated = await isCommitIntegrated(scope.scopeRoot, branch, "HEAD");
        if (integrated) {
          ctx.candidates.push({
            candidate: branch,
            store: "git-branches",
            decision: "delete",
            reason: "integrated-run-branch",
            age: 0,
            owner: matchingRun?.id ?? allocation,
            estimatedBytes: 0,
          });
          if (!ctx.dryRun) {
            const current = this.deps.runState.listRunStates(scope.scopeId).find(run => allocationName(run.id) === allocation);
            if (current && this.runIsProtected(scope.scopeId, current.id)) continue;
            const deleted = await deleteGitBranch(scope.scopeRoot, branch);
            if (deleted) ctx.recordReclaimed("git-branches", 1, 0);
          }
        } else {
          ctx.candidates.push({
            candidate: branch,
            store: "git-branches",
            decision: "needs_attention",
            reason: "commit-not-integrated",
            age: 0,
            owner: matchingRun?.id ?? allocation,
            estimatedBytes: 0,
            remediation: `Inspect and reconcile unintegrated branch ${branch} into target branch`,
          });
        }
      }
    }
  }

  private collectProcesses(ctx: {
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    if (ctx.dryRun) return;
    try {
      const staleCount = this.deps.runState.cleanStaleProcesses();
      if (staleCount.count > 0) {
        ctx.candidates.push({
          candidate: "stale-run-processes",
          store: "processes",
          decision: "delete",
          reason: "stale-process-record",
          age: 0,
          owner: "run-state",
          estimatedBytes: staleCount.count * 100,
        });
        if (!ctx.dryRun) {
          ctx.recordReclaimed("processes", staleCount.count, staleCount.count * 100);
        }
      }
    } catch {
      // Process cleanup is non-fatal
    }
  }

  private collectSessions(ctx: {
    targetScopeId?: string;
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    if (!this.deps.sessions) return;
    const idleTtlMs = this.deps.sessionIdleTtlMs ?? DEFAULT_SESSION_IDLE_TTL_MS;

    for (const [id, session] of this.deps.sessions) {
      if (ctx.targetScopeId && session.scopeId !== ctx.targetScopeId) continue;
      const age = Math.max(0, ctx.nowMs - session.lastActive);
      const isExpired = age > idleTtlMs;

      if (isExpired) {
        ctx.candidates.push({
          candidate: id,
          store: "sessions",
          decision: "delete",
          reason: "idle-session-expired",
          age,
          owner: id,
          estimatedBytes: 1024,
        });
        if (!ctx.dryRun) {
          this.deps.sessions.delete(id);
          this.deps.emitSessionUnregistered?.(session.scopeId, id);
          ctx.recordReclaimed("sessions", 1, 1024);
        }
      } else {
        ctx.candidates.push({
          candidate: id,
          store: "sessions",
          decision: "keep",
          reason: "session-within-ttl",
          age,
          owner: id,
          estimatedBytes: 1024,
        });
      }
    }
  }

  private collectChatBindings(ctx: {
    targetScopeId?: string;
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    if (!this.deps.chatBindings) return;
    const idleTtlMs = this.deps.sessionIdleTtlMs ?? DEFAULT_SESSION_IDLE_TTL_MS;

    for (const binding of this.deps.chatBindings.list()) {
      if (ctx.targetScopeId && binding.scopeId !== ctx.targetScopeId) continue;
      const age = Math.max(0, ctx.nowMs - new Date(binding.lastActiveAt).getTime());
      const hasLiveSession = this.deps.sessions?.has(binding.sessionId) ?? false;

      if (!hasLiveSession && age > idleTtlMs) {
        ctx.candidates.push({
          candidate: binding.sessionId,
          store: "chat-bindings",
          decision: "delete",
          reason: "stale-chat-binding",
          age,
          owner: binding.sessionId,
          estimatedBytes: 256,
        });
        if (!ctx.dryRun) {
          this.deps.chatBindings.delete(binding.sessionId);
          ctx.recordReclaimed("chat-bindings", 1, 256);
        }
      } else {
        ctx.candidates.push({
          candidate: binding.sessionId,
          store: "chat-bindings",
          decision: "keep",
          reason: hasLiveSession ? "active-chat-binding" : "chat-binding-within-ttl",
          age,
          owner: binding.sessionId,
          estimatedBytes: 256,
        });
      }
    }
  }

  private async collectOwnerRecords(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    for (const scope of ctx.scopes) {
      // Approvals
      const approvalsDir = join(scope.scopeRoot, ".kota", "approvals");
      if (existsSync(approvalsDir)) {
        let files: string[] = [];
        try {
          files = readdirSync(approvalsDir).filter((f) => f.endsWith(".json"));
        } catch {
          files = [];
        }
        for (const file of files) {
          await yieldToControl();
          const filePath = join(approvalsDir, file);
          let raw: string;
          try {
            raw = readFileSync(filePath, "utf-8");
          } catch {
            continue;
          }
          let parsed: { id?: string; status?: string; createdAt?: string; resolvedAt?: string };
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            ctx.candidates.push({
              candidate: file,
              store: "owner-records",
              decision: "needs_attention",
              reason: "malformed-approval-record",
              age: 0,
              owner: file,
              estimatedBytes: 0,
              remediation: `Inspect or repair malformed approval file ${filePath}: ${String(error)}`,
            });
            continue;
          }

          const createdAtMs = parsed.createdAt ? new Date(parsed.createdAt).getTime() : ctx.nowMs;
          const age = Math.max(0, ctx.nowMs - createdAtMs);
          const fileSize = statSync(filePath, { throwIfNoEntry: false })?.size ?? raw.length;

          if (
            parsed.status === "approved" ||
            parsed.status === "rejected" ||
            parsed.status === "expired"
          ) {
            if (age > RESOLVED_APPROVAL_RETENTION_MS) {
              ctx.candidates.push({
                candidate: parsed.id ?? file,
                store: "owner-records",
                decision: "delete",
                reason: "resolved-approval-past-retention",
                age,
                owner: parsed.id ?? file,
                estimatedBytes: fileSize,
              });
              if (!ctx.dryRun) {
                unlinkSync(filePath);
                ctx.recordReclaimed("owner-records", 1, fileSize);
              }
            } else {
              ctx.candidates.push({
                candidate: parsed.id ?? file,
                store: "owner-records",
                decision: "keep",
                reason: "resolved-approval-within-retention",
                age,
                owner: parsed.id ?? file,
                estimatedBytes: fileSize,
              });
            }
          } else {
            ctx.candidates.push({
              candidate: parsed.id ?? file,
              store: "owner-records",
              decision: "keep",
              reason: "pending-approval-active",
              age,
              owner: parsed.id ?? file,
              estimatedBytes: fileSize,
            });
          }
        }
      }

      // Owner Decisions
      const decisionsDir = join(scope.scopeRoot, ".kota", "owner-decisions");
      if (existsSync(decisionsDir)) {
        let files: string[] = [];
        try {
          files = readdirSync(decisionsDir).filter((f) => f.endsWith(".json"));
        } catch {
          files = [];
        }
        for (const file of files) {
          await yieldToControl();
          const filePath = join(decisionsDir, file);
          let raw: string;
          try {
            raw = readFileSync(filePath, "utf-8");
          } catch {
            continue;
          }
          let parsed: { id?: string; status?: string; createdAt?: string; expiresAt?: string };
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            ctx.candidates.push({
              candidate: file,
              store: "owner-records",
              decision: "needs_attention",
              reason: "malformed-owner-decision",
              age: 0,
              owner: file,
              estimatedBytes: 0,
              remediation: `Inspect or repair malformed owner decision file ${filePath}: ${String(error)}`,
            });
            continue;
          }

          const age = Math.max(0, ctx.nowMs - new Date(parsed.createdAt ?? ctx.nowMs).getTime());
          const fileSize = statSync(filePath, { throwIfNoEntry: false })?.size ?? raw.length;

          if (parsed.status === "pending" && parsed.expiresAt && ctx.nowMs >= new Date(parsed.expiresAt).getTime()) {
            ctx.candidates.push({
              candidate: parsed.id ?? file,
              store: "owner-records",
              decision: "compact",
              reason: "pending-owner-decision-expired",
              age,
              owner: parsed.id ?? file,
              estimatedBytes: fileSize,
            });
          } else {
            ctx.candidates.push({
              candidate: parsed.id ?? file,
              store: "owner-records",
              decision: "keep",
              reason: parsed.status === "pending" ? "pending-owner-decision-active" : "resolved-owner-decision",
              age,
              owner: parsed.id ?? file,
              estimatedBytes: fileSize,
            });
          }
        }
      }
    }
  }

  private async collectIdempotency(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    for (const scope of ctx.scopes) {
      const idempotencyDir = join(scope.scopeRoot, ".kota", "idempotency");
      if (!existsSync(idempotencyDir)) continue;

      let files: string[] = [];
      try {
        files = readdirSync(idempotencyDir).filter((f) => f.endsWith(".json"));
      } catch {
        continue;
      }

      for (const file of files) {
          await yieldToControl();
        const filePath = join(idempotencyDir, file);
        let raw: string;
        try {
          raw = readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }

        let parsed: { id?: string; key?: string; status?: string; createdAt?: string; expiresAt?: string };
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          ctx.candidates.push({
            candidate: file,
            store: "idempotency",
            decision: "needs_attention",
            reason: "malformed-idempotency-record",
            age: 0,
            owner: file,
            estimatedBytes: 0,
            remediation: `Inspect or remove malformed idempotency file ${filePath}: ${String(error)}`,
          });
          continue;
        }

        const age = Math.max(0, ctx.nowMs - new Date(parsed.createdAt ?? ctx.nowMs).getTime());
        const fileSize = statSync(filePath, { throwIfNoEntry: false })?.size ?? raw.length;
        const isExpired =
          parsed.status === "expired" ||
          (parsed.expiresAt !== undefined && Date.parse(parsed.expiresAt) <= ctx.nowMs);

        if (isExpired) {
          ctx.candidates.push({
            candidate: parsed.id ?? file,
            store: "idempotency",
            decision: "delete",
            reason: "idempotency-entry-expired",
            age,
            owner: parsed.key ?? parsed.id ?? file,
            estimatedBytes: fileSize,
          });
          if (!ctx.dryRun) {
            unlinkSync(filePath);
            ctx.recordReclaimed("idempotency", 1, fileSize);
          }
        } else {
          ctx.candidates.push({
            candidate: parsed.id ?? file,
            store: "idempotency",
            decision: "keep",
            reason: "idempotency-entry-active",
            age,
            owner: parsed.key ?? parsed.id ?? file,
            estimatedBytes: fileSize,
          });
        }
      }
    }
  }

  private async collectTemporaryPayloads(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    for (const scope of ctx.scopes) {
      const runtimeDir = join(scope.scopeRoot, ".kota", "runtime");
      if (!existsSync(runtimeDir)) continue;

      let entries: string[] = [];
      try {
        entries = readdirSync(runtimeDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.endsWith(".tmp")) {
          const filePath = join(runtimeDir, entry);
          const stat = statSync(filePath, { throwIfNoEntry: false });
          if (!stat) continue;
          const age = Math.max(0, ctx.nowMs - stat.mtimeMs);
          ctx.candidates.push({
            candidate: filePath,
            store: "temporary-payloads",
            decision: "delete",
            reason: "temporary-payload-unreachable",
            age,
            owner: "runtime",
            estimatedBytes: stat.size,
          });
          if (!ctx.dryRun) {
            rmSync(filePath, { force: true });
            ctx.recordReclaimed("temporary-payloads", 1, stat.size);
          }
        }
      }
    }
  }

  private async collectRunArtifacts(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    targetRunId?: string;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    const minKeepPerWorkflow = 10;

    for (const scope of ctx.scopes) {
      const runsDir = join(scope.scopeRoot, ".kota", "runs");
      if (!existsSync(runsDir)) continue;

      const protectedIds = new Set<string>();
      const authorityCriticalIds = new Set<string>();
      const operationallyActiveIds = new Set<string>();
      const storedRuns = this.deps.runState.listRunStates(scope.scopeId);
      const terminalRunIds = workflowRunMetadataTerminalIds(storedRuns);
      for (const run of storedRuns) {
        if (
          run.state === "queued" ||
          run.state === "running" ||
          run.state === "waiting" ||
          run.state === "integrating" ||
          run.state === "needs_attention"
        ) {
          protectedIds.add(run.id);
          if (run.state !== "queued") {
            authorityCriticalIds.add(run.id);
            operationallyActiveIds.add(run.id);
          }
        }
      }
      for (const publication of this.deps.runState.listPendingPublicationHeads()) {
        if (publication.scopeId !== scope.scopeId) continue;
        protectedIds.add(publication.runId);
        authorityCriticalIds.add(publication.runId);
      }

      for (const trackedId of await listTrackedRunIds(scope.scopeRoot, runsDir)) {
        protectedIds.add(trackedId);
      }

      type RunCandidateMeta = {
        directoryId: StoredWorkflowRunDirectoryId;
        workflow: string;
        startedAtMs: number;
        retainedFromMs: number;
        metadata: LifecycleRunMetadata;
      };

      const parsedRuns: RunCandidateMeta[] = [];
      const metadataStarted = performance.now();
      const inspection = await runWorkflowBlockingOperation(inspectRunMetadataOperation, { runsDir,
        authorityCriticalRunIds: [...authorityCriticalIds],
        operationallyActiveRunIds: [...operationallyActiveIds],
        terminalRunIds: [...terminalRunIds],
      });

      if (inspection.kind === "invalid-authority") throw new WorkflowRunMetadataAuthorityError(inspection.diagnostic);
      const enumeration = inspection.enumeration;
      this.deps.log?.(`Lifecycle run metadata: ${enumeration.runs.length} runs, ${(performance.now() - metadataStarted).toFixed(1)}ms`);
      let sizedRuns = 0;
      let sizingMs = 0;
      for (const diagnostic of enumeration.diagnostics) {
        const directoryId = basename(dirname(diagnostic.source));
        if (ctx.targetRunId && directoryId !== ctx.targetRunId) continue;
        ctx.candidates.push({
          candidate: directoryId,
          store: "run-artifacts",
          decision: "needs_attention",
          reason: "invalid-workflow-run-metadata",
          age: 0,
          owner: diagnostic.facts.workflow ?? "workflow-runtime",
          estimatedBytes: 0,
          remediation: diagnostic.recoveryAction,
        });
      }

      for (const meta of enumeration.runs) {
        const runDir = resolveRunArtifactDeletionTarget(runsDir, meta.id);
        if (runDir === null) {
          ctx.candidates.push({
            candidate: meta.id,
            store: "run-artifacts",
            decision: "needs_attention",
            reason: "unsafe-workflow-run-directory",
            age: 0,
            owner: meta.workflow,
            estimatedBytes: 0,
            remediation: "Repair the run directory identity before retrying lifecycle collection",
          });
          continue;
        }
        const startedAtMs = new Date(meta.startedAt).getTime();
        const retainedFromMs = meta.status === "running"
          ? startedAtMs
          : new Date(meta.completedAt ?? meta.startedAt).getTime();
        parsedRuns.push({
          directoryId: meta.id,
          workflow: meta.workflow,
          startedAtMs,
          retainedFromMs,
          metadata: meta,
        });
      }

      const byWorkflow: Record<string, RunCandidateMeta[]> = {};
      for (const run of parsedRuns) {
        if (!byWorkflow[run.workflow]) byWorkflow[run.workflow] = [];
        byWorkflow[run.workflow].push(run);
      }

      for (const wfRuns of Object.values(byWorkflow)) {
        wfRuns.sort((a, b) => b.startedAtMs - a.startedAtMs);
        for (let i = 0; i < wfRuns.length; i++) {
          const run = wfRuns[i];
          if (ctx.targetRunId && run.directoryId !== ctx.targetRunId) continue;

          const age = Math.max(0, ctx.nowMs - run.startedAtMs);
          const isProtected = protectedIds.has(run.directoryId);
          const isUnderMinKeep = i < minKeepPerWorkflow;

          const resolved = resolveEvidenceRetention({
            artifactType: "workflow-run",
            state: run.metadata.status === "running" ? "active" : "terminal",
            scope: "directory",
            retainedFrom: new Date(run.retainedFromMs),
          });
          const isExpired = resolved.kind === "expires" && Date.parse(resolved.expiresAt) <= ctx.nowMs;

          if (isProtected) {
            ctx.candidates.push({
              candidate: run.directoryId,
              store: "run-artifacts",
              decision: "keep",
              reason: "protected-workflow-run",
              age,
              owner: run.workflow,
              estimatedBytes: 0,
            });
          } else if (isUnderMinKeep) {
            ctx.candidates.push({
              candidate: run.directoryId,
              store: "run-artifacts",
              decision: "keep",
              reason: "workflow-minimum-retained",
              age,
              owner: run.workflow,
              estimatedBytes: 0,
            });
          } else if (isExpired) {
            const deletionTarget = resolveRunArtifactDeletionTarget(runsDir, run.directoryId);
            if (deletionTarget === null) throw new Error("Unsafe run artifact directory");
            const sizingStarted = performance.now();
            const dirSize = await safeGetDirectorySize(deletionTarget);
            sizedRuns++;
            sizingMs += performance.now() - sizingStarted;
            if (this.runIsProtected(scope.scopeId, run.directoryId)) {
              ctx.candidates.push({ candidate: run.directoryId, store: "run-artifacts", decision: "keep",
                reason: "protected-workflow-run", age, owner: run.workflow, estimatedBytes: 0 });
              continue;
            }
            ctx.candidates.push({
              candidate: run.directoryId,
              store: "run-artifacts",
              decision: "compact",
              reason: "terminal-run-past-retention",
              age,
              owner: run.workflow,
              estimatedBytes: dirSize,
            });
            if (!ctx.dryRun) {
              if ((await listTrackedRunIds(scope.scopeRoot, runsDir)).has(run.directoryId)) continue;
              if (this.runIsProtected(scope.scopeId, run.directoryId)) continue;
              // Metadata may have been refreshed while the worker or sizing was in flight.
              const current = readWorkflowRunMetadataFile(join(deletionTarget, "metadata.json"));
              if (!current || current.status !== run.metadata.status || current.startedAt !== run.metadata.startedAt ||
                  current.completedAt !== run.metadata.completedAt || current.workflow !== run.workflow) continue;
              if (!lstatSync(deletionTarget, { throwIfNoEntry: false })?.isDirectory()) continue;
              const prunedAt = new Date(ctx.nowMs).toISOString();
              const reference = buildEvidencePrunedReference({
                artifactType: "workflow-run",
                id: run.metadata.id,
                prunedAt,
                retained: {
                  id: run.metadata.id,
                  workflow: run.metadata.workflow,
                  status: run.metadata.status,
                  startedAt: run.metadata.startedAt,
                  ...(run.metadata.completedAt !== undefined ? { completedAt: run.metadata.completedAt } : {}),
                  ...(run.metadata.durationMs !== undefined ? { durationMs: run.metadata.durationMs } : {}),
                },
                provenance: {
                  workflowName: run.metadata.workflow,
                  runId: run.metadata.id,
                  sourceEventIds: run.metadata.trigger.eventId ? [run.metadata.trigger.eventId] : [],
                  transformedFrom: [],
                },
              });
              appendFileSync(
                join(runsDir, PRUNED_RUN_REFERENCES_FILE),
                `${JSON.stringify(reference)}\n`,
                "utf-8",
              );
              await removeCollectedDirectory(deletionTarget, join(scope.scopeRoot, ".kota", "runtime"));
              ctx.recordReclaimed("run-artifacts", 1, dirSize);
            }
          } else {
            ctx.candidates.push({
              candidate: run.directoryId,
              store: "run-artifacts",
              decision: "keep",
              reason: "workflow-run-within-retention",
              age,
              owner: run.workflow,
              estimatedBytes: 0,
            });
          }
        }
      }
      this.deps.log?.(`Lifecycle run sizing: ${sizedRuns} runs, ${sizingMs.toFixed(1)}ms`);
    }
  }

  private async collectEventJournal(ctx: {
    nowMs: number;
    nowDate: Date;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    const journalPath = join(this.deps.stateDir, "events", "journal.jsonl");
    if (!existsSync(journalPath)) return;

    const prepared = await runWorkflowBlockingOperation(prepareJournalOperation, {
      journalPath, nowMs: ctx.nowMs, dryRun: ctx.dryRun,
    });
    if (prepared === null) return;
    ctx.candidates.push({ candidate: journalPath, store: "event-journal",
      decision: prepared.expiredCount > 0 ? "compact" : "keep",
      reason: prepared.expiredCount > 0 ? "event-journal-payload-expired" : "event-journal-within-retention",
      age: 0, owner: "event-journal", estimatedBytes: prepared.size });
    if (prepared.tempPath) {
      try {
        if (commitJournal(journalPath, prepared)) {
          ctx.recordReclaimed("event-journal", prepared.expiredCount, prepared.reclaimedBytes);
        }
      } finally { await rm(prepared.tempPath, { force: true }); }
    }
  }

  private async collectDeadLetters(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): Promise<void> {
    for (const scope of ctx.scopes) {
      await yieldToControl();
      const itemsFile = join(scope.scopeRoot, ".kota", "dead-letter-queue", "items.json");
      if (!existsSync(itemsFile)) continue;

      let raw: string;
      try {
        raw = readFileSync(itemsFile, "utf-8");
      } catch {
        continue;
      }

      let snapshot: { items?: Array<{ id: string; status: string; createdAt: string; retention?: { kind: string; expiresAt?: string } }> };
      try {
        snapshot = JSON.parse(raw);
      } catch (error) {
        ctx.candidates.push({
          candidate: itemsFile,
          store: "dead-letters",
          decision: "needs_attention",
          reason: "malformed-dead-letter-file",
          age: 0,
          owner: "dead-letter-queue",
          estimatedBytes: 0,
          remediation: `Inspect or repair malformed dead letter file ${itemsFile}: ${String(error)}`,
        });
        continue;
      }

      const items = Array.isArray(snapshot.items) ? snapshot.items : [];
      const keptItems = [];
      let compactedCount = 0;

      for (const item of items) {
        const age = Math.max(0, ctx.nowMs - new Date(item.createdAt ?? ctx.nowMs).getTime());
        const isExpired =
          item.retention?.kind === "expire-after-ms" &&
          item.retention.expiresAt !== undefined &&
          Date.parse(item.retention.expiresAt) <= ctx.nowMs;

        if (item.status === "open") {
          ctx.candidates.push({
            candidate: item.id,
            store: "dead-letters",
            decision: "keep",
            reason: "open-dead-letter",
            age,
            owner: item.id,
            estimatedBytes: JSON.stringify(item).length,
          });
          keptItems.push(item);
        } else if (isExpired || age > RESOLVED_DEAD_LETTER_RETENTION_MS) {
          ctx.candidates.push({
            candidate: item.id,
            store: "dead-letters",
            decision: "compact",
            reason: "closed-dead-letter-past-retention",
            age,
            owner: item.id,
            estimatedBytes: JSON.stringify(item).length,
          });
          compactedCount += 1;
        } else {
          ctx.candidates.push({
            candidate: item.id,
            store: "dead-letters",
            decision: "keep",
            reason: "closed-dead-letter-within-retention",
            age,
            owner: item.id,
            estimatedBytes: JSON.stringify(item).length,
          });
          keptItems.push(item);
        }
      }

      if (compactedCount > 0 && !ctx.dryRun) {
        const newSnapshot = { items: keptItems };
        writeJsonFileAtomic(itemsFile, newSnapshot);
        const newBytes = JSON.stringify(newSnapshot).length;
        const reclaimedBytes = Math.max(0, raw.length - newBytes);
        ctx.recordReclaimed("dead-letters", compactedCount, reclaimedBytes);
      }
    }
  }

  private collectRunStateDatabase(ctx: {
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    const cutoffPublications = new Date(ctx.nowMs - DELIVERED_PUBLICATION_RETENTION_MS).toISOString();
    const cutoffRuns = new Date(ctx.nowMs - TERMINAL_RUN_DB_RETENTION_MS).toISOString();

    try {
      if (!ctx.dryRun) {
        const pubResult = this.deps.runState.pruneDeliveredPublications(cutoffPublications);
        if (pubResult.count > 0) {
          ctx.candidates.push({
            candidate: "delivered-publications",
            store: "run-state-database",
            decision: "compact",
            reason: "delivered-publication-past-retention",
            age: DELIVERED_PUBLICATION_RETENTION_MS,
            owner: "run-state",
            estimatedBytes: pubResult.count * 256,
          });
          ctx.recordReclaimed("run-state-database", pubResult.count, pubResult.count * 256);
        }

        const runResult = this.deps.runState.pruneTerminalRuns({
          finishedBefore: cutoffRuns,
        });
        if (runResult.count > 0) {
          ctx.candidates.push({
            candidate: "terminal-run-records",
            store: "run-state-database",
            decision: "compact",
            reason: "terminal-run-record-past-retention",
            age: TERMINAL_RUN_DB_RETENTION_MS,
            owner: "run-state",
            estimatedBytes: runResult.count * 1024,
          });
          ctx.recordReclaimed("run-state-database", runResult.count, runResult.count * 1024);
        }

        const vacuumResult = this.deps.runState.compact();
        if (vacuumResult.bytesReclaimed > 0) {
          ctx.recordReclaimed("run-state-database", 1, vacuumResult.bytesReclaimed);
        }
      } else {
        ctx.candidates.push({
          candidate: "run-state-database-compaction",
          store: "run-state-database",
          decision: "compact",
          reason: "database-compaction",
          age: 0,
          owner: "run-state",
          estimatedBytes: 1024,
        });
      }
    } catch {
      // Database compaction failure is non-fatal
    }
  }
}
