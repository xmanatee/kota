import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  buildEvidencePrunedReference,
  resolveEvidenceRetention,
} from "#core/evidence/policy.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  enumerateWorkflowRunMetadata,
  workflowRunMetadataTerminalIds,
} from "#core/workflow/run-metadata.js";
import { allocationName } from "#core/workflow/run-sandbox.js";
import type { StoredRun } from "#core/workflow/run-state-types.js";
import { PRUNED_RUN_REFERENCES_FILE } from "#core/workflow/run-store-retention.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
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

function safeGetDirectorySize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          total += safeGetDirectorySize(fullPath);
        } else {
          total += statSync(fullPath).size;
        }
      } catch {
        // Ignore unreadable or transient files
      }
    }
  } catch {
    // Ignore unreadable directory
  }
  return total;
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepository(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return safeGit(dir, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

function isWorktreeDirty(worktreeDir: string): boolean {
  const status = safeGit(worktreeDir, ["status", "--porcelain"]);
  if (status === null) return true;
  return status.length > 0;
}

function isCommitIntegrated(
  repoRoot: string,
  commitOrBranch: string,
  targetCommitOrBranch = "HEAD",
): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", commitOrBranch, targetCommitOrBranch], {
      cwd: repoRoot,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function listKotaRunBranches(repoRoot: string): string[] {
  const output = safeGit(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads/kota/run/*"]);
  if (!output) return [];
  return output
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

function deleteGitBranch(repoRoot: string, branchName: string): boolean {
  try {
    execFileSync("git", ["branch", "-D", branchName], {
      cwd: repoRoot,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function removeGitWorktree(repoRoot: string, worktreeDir: string): boolean {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: repoRoot,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function listTrackedRunIds(scopeRoot: string, runsDir: string): Set<string> {
  const runsPath = relative(scopeRoot, runsDir).split("\\").join("/");
  if (!runsPath || runsPath.startsWith("..")) return new Set();

  try {
    const output = execFileSync("git", ["ls-files", "--", runsPath], {
      cwd: scopeRoot,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!output) return new Set();

    const prefix = `${runsPath.replace(/\/+$/, "")}/`;
    const runIds = new Set<string>();
    for (const line of output.split("\n")) {
      if (!line.startsWith(prefix)) continue;
      const runId = line.slice(prefix.length).split("/", 1)[0];
      if (runId) runIds.add(runId);
    }
    return runIds;
  } catch {
    return new Set();
  }
}

export class LifecycleCollector {
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

  async sweep(options: LifecycleSweepOptions = {}): Promise<LifecycleSweepReport> {
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
    this.collectSandboxes({
      scopes,
      nowMs,
      targetRunId,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 2. Git Branches
    this.collectGitBranches({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 3. Processes
    this.collectProcesses({
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 4. Sessions
    this.collectSessions({
      targetScopeId,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 5. Chat Bindings
    this.collectChatBindings({
      targetScopeId,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 6. Owner Records
    this.collectOwnerRecords({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 7. Idempotency Records
    this.collectIdempotency({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 8. Temporary Payloads
    this.collectTemporaryPayloads({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 9. Run Artifacts
    this.collectRunArtifacts({
      scopes,
      nowMs,
      targetRunId,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 10. Event Journal
    this.collectEventJournal({
      nowMs,
      nowDate,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 11. Dead Letters
    this.collectDeadLetters({
      scopes,
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

    // 12. RunStateDatabase SQLite
    this.collectRunStateDatabase({
      nowMs,
      dryRun,
      candidates,
      recordReclaimed,
    });

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

  private collectSandboxes(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    targetRunId?: string;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    for (const scope of ctx.scopes) {
      const runtimeDir = join(scope.scopeRoot, ".kota", "runtime");
      if (!existsSync(runtimeDir)) continue;

      let storedRuns: StoredRun[] = [];
      try {
        storedRuns = this.deps.runState.listRuns(scope.scopeId);
      } catch {
        storedRuns = [];
      }
      const allocationToRun = new Map<string, StoredRun>();
      for (const run of storedRuns) {
        allocationToRun.set(allocationName(run.id), run);
      }

      let entries: string[] = [];
      try {
        entries = readdirSync(runtimeDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry === "worktrees" || entry === "tmp" || entry.endsWith(".tmp")) continue;
        const rootDir = join(runtimeDir, entry);
        const stat = statSync(rootDir, { throwIfNoEntry: false });
        if (!stat?.isDirectory()) continue;

        const matchingRun = allocationToRun.get(entry);
        if (ctx.targetRunId && matchingRun && matchingRun.id !== ctx.targetRunId) {
          continue;
        }

        if (matchingRun) {
          const finishedAtMs = matchingRun.finishedAt
            ? new Date(matchingRun.finishedAt).getTime()
            : matchingRun.startedAt
              ? new Date(matchingRun.startedAt).getTime()
              : new Date(matchingRun.admittedAt).getTime();
          const age = Math.max(0, ctx.nowMs - finishedAtMs);
          const rootBytes = safeGetDirectorySize(rootDir);

          const isActive =
            matchingRun.state === "queued" ||
            matchingRun.state === "running" ||
            matchingRun.state === "waiting" ||
            matchingRun.state === "integrating" ||
            matchingRun.state === "needs_attention";

          if (isActive) {
            ctx.candidates.push({
              candidate: rootDir,
              store: "sandboxes",
              decision: "keep",
              reason: "active-run-sandbox",
              age,
              owner: matchingRun.id,
              estimatedBytes: rootBytes,
            });
            continue;
          }

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
              rmSync(rootDir, { recursive: true, force: true });
              ctx.recordReclaimed("sandboxes", 1, rootBytes);
            }
          } else {
            // "read" or "write" repo sandbox
            const worktreeDir = join(runtimeDir, "worktrees", entry);
            const worktreeExists = existsSync(worktreeDir);
            const worktreeBytes = worktreeExists ? safeGetDirectorySize(worktreeDir) : 0;
            const totalBytes = rootBytes + worktreeBytes;

            if (worktreeExists) {
              if (isWorktreeDirty(worktreeDir)) {
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
                const integrated = isCommitIntegrated(scope.scopeRoot, branchName, "HEAD");
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
                removeGitWorktree(scope.scopeRoot, worktreeDir);
                if (matchingRun.repository === "write") {
                  deleteGitBranch(scope.scopeRoot, `kota/run/${entry}`);
                }
                rmSync(worktreeDir, { recursive: true, force: true });
                rmSync(rootDir, { recursive: true, force: true });
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
                rmSync(rootDir, { recursive: true, force: true });
                ctx.recordReclaimed("sandboxes", 1, rootBytes);
              }
            }
          }
        } else {
          // Orphaned runtime directory with no matching run
          const age = Math.max(0, ctx.nowMs - (stat?.mtimeMs ?? ctx.nowMs));
          const rootBytes = safeGetDirectorySize(rootDir);
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
            rmSync(rootDir, { recursive: true, force: true });
            ctx.recordReclaimed("sandboxes", 1, rootBytes);
          }
        }
      }
    }
  }

  private collectGitBranches(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    for (const scope of ctx.scopes) {
      if (!isGitRepository(scope.scopeRoot)) continue;

      let storedRuns: StoredRun[] = [];
      try {
        storedRuns = this.deps.runState.listRuns(scope.scopeId);
      } catch {
        storedRuns = [];
      }
      const allocationToRun = new Map<string, StoredRun>();
      for (const run of storedRuns) {
        allocationToRun.set(allocationName(run.id), run);
      }

      const branches = listKotaRunBranches(scope.scopeRoot);
      for (const branch of branches) {
        const allocation = branch.replace(/^kota\/run\//, "");
        const matchingRun = allocationToRun.get(allocation);

        if (matchingRun) {
          const isActive =
            matchingRun.state === "queued" ||
            matchingRun.state === "running" ||
            matchingRun.state === "waiting" ||
            matchingRun.state === "integrating" ||
            matchingRun.state === "needs_attention";

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

        const integrated = isCommitIntegrated(scope.scopeRoot, branch, "HEAD");
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
            const deleted = deleteGitBranch(scope.scopeRoot, branch);
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

  private collectOwnerRecords(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
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

  private collectIdempotency(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
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

  private collectTemporaryPayloads(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
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

  private collectRunArtifacts(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    targetRunId?: string;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    const minKeepPerWorkflow = 10;

    for (const scope of ctx.scopes) {
      const runsDir = join(scope.scopeRoot, ".kota", "runs");
      if (!existsSync(runsDir)) continue;

      const protectedIds = new Set<string>();
      const authorityCriticalIds = new Set<string>();
      const operationallyActiveIds = new Set<string>();
      const storedRuns = this.deps.runState.listRuns(scope.scopeId);
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

      for (const trackedId of listTrackedRunIds(scope.scopeRoot, runsDir)) {
        protectedIds.add(trackedId);
      }

      type RunCandidateMeta = {
        id: string;
        workflow: string;
        startedAtMs: number;
        retainedFromMs: number;
        metadata: WorkflowRunMetadata;
        dirSize: number;
      };

      const parsedRuns: RunCandidateMeta[] = [];

      for (const meta of enumerateWorkflowRunMetadata(runsDir, {
        authorityCriticalRunIds: authorityCriticalIds,
        operationallyActiveRunIds: operationallyActiveIds,
        terminalRunIds,
      }).runs) {
        const runDir = join(runsDir, meta.id);
        const dirSize = safeGetDirectorySize(runDir);
        const startedAtMs = new Date(meta.startedAt).getTime();
        const retainedFromMs = meta.status === "running"
          ? startedAtMs
          : new Date(meta.completedAt ?? meta.startedAt).getTime();
        parsedRuns.push({
          id: meta.id,
          workflow: meta.workflow,
          startedAtMs,
          retainedFromMs,
          metadata: meta,
          dirSize,
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
          if (ctx.targetRunId && run.id !== ctx.targetRunId) continue;

          const age = Math.max(0, ctx.nowMs - run.startedAtMs);
          const isProtected = protectedIds.has(run.id);
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
              candidate: run.id,
              store: "run-artifacts",
              decision: "keep",
              reason: "protected-workflow-run",
              age,
              owner: run.workflow,
              estimatedBytes: run.dirSize,
            });
          } else if (isUnderMinKeep) {
            ctx.candidates.push({
              candidate: run.id,
              store: "run-artifacts",
              decision: "keep",
              reason: "workflow-minimum-retained",
              age,
              owner: run.workflow,
              estimatedBytes: run.dirSize,
            });
          } else if (isExpired) {
            ctx.candidates.push({
              candidate: run.id,
              store: "run-artifacts",
              decision: "compact",
              reason: "terminal-run-past-retention",
              age,
              owner: run.workflow,
              estimatedBytes: run.dirSize,
            });
            if (!ctx.dryRun) {
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
              rmSync(join(runsDir, run.id), { recursive: true, force: true });
              ctx.recordReclaimed("run-artifacts", 1, run.dirSize);
            }
          } else {
            ctx.candidates.push({
              candidate: run.id,
              store: "run-artifacts",
              decision: "keep",
              reason: "workflow-run-within-retention",
              age,
              owner: run.workflow,
              estimatedBytes: run.dirSize,
            });
          }
        }
      }
    }
  }

  private collectEventJournal(ctx: {
    nowMs: number;
    nowDate: Date;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    const journalPath = join(this.deps.stateDir, "events", "journal.jsonl");
    if (!existsSync(journalPath)) return;

    let content: string;
    try {
      content = readFileSync(journalPath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    let expiredCount = 0;
    const keptLines: string[] = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (
          event.retention?.kind === "expire-after-ms" &&
          event.timestamps?.journaledAt &&
          Date.parse(event.timestamps.journaledAt) + event.retention.durationMs <= ctx.nowMs
        ) {
          expiredCount += 1;
        } else {
          keptLines.push(line);
        }
      } catch {
        keptLines.push(line);
      }
    }

    const totalBytes = content.length;
    if (expiredCount > 0) {
      ctx.candidates.push({
        candidate: journalPath,
        store: "event-journal",
        decision: "compact",
        reason: "event-journal-payload-expired",
        age: 0,
        owner: "event-journal",
        estimatedBytes: totalBytes,
      });

      if (!ctx.dryRun) {
        const newContent = keptLines.length > 0 ? `${keptLines.join("\n")}\n` : "";
        const tmpPath = `${journalPath}.tmp-${Date.now()}`;
        writeFileSync(tmpPath, newContent, "utf-8");
        writeFileSync(journalPath, newContent, "utf-8");
        rmSync(tmpPath, { force: true });
        const reclaimedBytes = Math.max(0, totalBytes - newContent.length);
        ctx.recordReclaimed("event-journal", expiredCount, reclaimedBytes);
      }
    } else {
      ctx.candidates.push({
        candidate: journalPath,
        store: "event-journal",
        decision: "keep",
        reason: "event-journal-within-retention",
        age: 0,
        owner: "event-journal",
        estimatedBytes: totalBytes,
      });
    }
  }

  private collectDeadLetters(ctx: {
    scopes: readonly { scopeId: string; scopeRoot: string }[];
    nowMs: number;
    dryRun: boolean;
    candidates: LifecycleCandidate[];
    recordReclaimed: (store: LifecycleStoreName, count: number, bytes: number) => void;
  }): void {
    for (const scope of ctx.scopes) {
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
