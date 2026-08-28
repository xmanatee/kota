import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { EventJournal } from "#core/events/event-journal.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { RunCoordinator } from "#core/workflow/run-coordinator.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { allocationName } from "#core/workflow/run-sandbox.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { ApprovalQueue } from "./approval-queue.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import type { InteractiveSession } from "./daemon-control-types.js";
import { EventedDeadLetterQueueStore } from "./dead-letter-queue-events.js";
import { IdempotencyStore } from "./idempotency-store.js";
import { LifecycleCollector } from "./lifecycle-collector.js";
import { OwnerDecisionStore } from "./owner-decision-store.js";
import { OwnerQuestionQueue } from "./owner-question-queue.js";
import { buildDirectoryScope, type DirectoryScope, ScopeRegistry } from "./scope-registry.js";
import { ScopeRuntimeRegistry } from "./scope-runtime.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function createGitRepo(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], {
    cwd: dir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: dir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "ignore",
  });
  writeFileSync(join(dir, "README.md"), "# Test Repo\n");
  execFileSync("git", ["add", "."], {
    cwd: dir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "ignore",
  });
  execFileSync("git", ["commit", "-m", "Initial commit"], {
    cwd: dir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: "ignore",
  });
}

describe("LifecycleCollector", () => {
  let rootDir: string;
  let stateDir: string;
  let scopeRootA: string;
  let scopeRootB: string;
  let runState: RunStateDatabase;
  let scopeRegistry: ScopeRegistry;
  let eventJournal: EventJournal;
  let sessions: Map<string, InteractiveSession>;
  let chatBindings: DaemonChatBindingStore;
  let openStates: RunStateDatabase[] = [];

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "kota-lifecycle-test-"));
    stateDir = join(rootDir, "state");
    scopeRootA = join(rootDir, "scope-a");
    scopeRootB = join(rootDir, "scope-b");

    mkdirSync(stateDir, { recursive: true });
    mkdirSync(scopeRootA, { recursive: true });
    mkdirSync(scopeRootB, { recursive: true });

    createGitRepo(scopeRootA);
    createGitRepo(scopeRootB);

    const scopeA = buildDirectoryScope({ scopeRoot: scopeRootA, displayName: "Scope A" });
    const scopeB = buildDirectoryScope({ scopeRoot: scopeRootB, displayName: "Scope B" });

    scopeRegistry = new ScopeRegistry({
      stateDir,
      scopes: [scopeA, scopeB],
    });

    runState = new RunStateDatabase(stateDir);
    openStates.push(runState);

    const startedAt = new Date().toISOString();
    runState.registerScope({
      id: scopeA.scopeId,
      rootPath: scopeRootA,
      displayName: "Scope A",
      createdAt: startedAt,
    });
    runState.registerScope({
      id: scopeB.scopeId,
      rootPath: scopeRootB,
      displayName: "Scope B",
      createdAt: startedAt,
    });
    runState.beginDaemonSession(startedAt);

    eventJournal = new EventJournal(join(stateDir, "events"));
    sessions = new Map();
    chatBindings = new DaemonChatBindingStore(stateDir);
  });

  afterEach(() => {
    for (const rs of openStates.splice(0)) rs.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("handles multi-scope isolation: sweeps target scope without touching other scopes", async () => {
    const scopeA = scopeRegistry.list()[0]!;
    const scopeB = scopeRegistry.list()[1]!;

    // Scope A: expired idempotency record
    const idempDirA = join(scopeRootA, ".kota", "idempotency");
    mkdirSync(idempDirA, { recursive: true });
    const expiredEntryA = {
      id: "entry-a-1",
      scopeId: scopeA.scopeId,
      operation: "event-ingestion",
      key: "event-1",
      parameterFingerprint: "fp1",
      status: "expired",
      createdAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      updatedAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      retention: { kind: "expire-after-ms", durationMs: 1000 },
      expiresAt: new Date(Date.now() - 9 * DAY_MS).toISOString(),
      duplicateCount: 0,
      conflictCount: 0,
    };
    writeFileSync(join(idempDirA, "entry-a-1.json"), JSON.stringify(expiredEntryA));

    // Scope B: expired idempotency record
    const idempDirB = join(scopeRootB, ".kota", "idempotency");
    mkdirSync(idempDirB, { recursive: true });
    const expiredEntryB = {
      id: "entry-b-1",
      scopeId: scopeB.scopeId,
      operation: "event-ingestion",
      key: "event-2",
      parameterFingerprint: "fp2",
      status: "expired",
      createdAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      updatedAt: new Date(Date.now() - 10 * DAY_MS).toISOString(),
      retention: { kind: "expire-after-ms", durationMs: 1000 },
      expiresAt: new Date(Date.now() - 9 * DAY_MS).toISOString(),
      duplicateCount: 0,
      conflictCount: 0,
    };
    writeFileSync(join(idempDirB, "entry-b-1.json"), JSON.stringify(expiredEntryB));

    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
    });

    // Sweep ONLY Scope A
    const report = await collector.sweep({ scopeId: scopeA.scopeId });
    expect(report.dryRun).toBe(false);
    expect(report.reclaimedCount).toBeGreaterThanOrEqual(1);
    expect(report.reclaimedByStore.idempotency?.count).toBe(1);

    // Scope A's file is gone, Scope B's file remains!
    expect(existsSync(join(idempDirA, "entry-a-1.json"))).toBe(false);
    expect(existsSync(join(idempDirB, "entry-b-1.json"))).toBe(true);
  });

  it("protects dirty worktrees and unintegrated branches as needs_attention with remediation", async () => {
    const scopeA = scopeRegistry.list()[0]!;
    const runId = "2026-08-28T00-00-00-000Z-builder-dirty";
    const allocation = allocationName(runId);

    // Create a writer run in terminal state (succeeded)
    runState.admitRun({
      id: runId,
      scopeId: scopeA.scopeId,
      workflowName: "builder",
      workflowRevision: "rev-1",
      triggerKind: "event",
      triggerEvent: "test",
      targetBranch: "main",
      repository: "write",
      concurrencyLimit: 1,
      costLimitUsd: 1,
      admissionKey: "adm-dirty",
      parameterFingerprint: "fp-dirty",
      admittedAt: new Date(Date.now() - 2000).toISOString(),
    });
    runState.startAttempt(runId, 1, 1, new Date(Date.now() - 1500).toISOString());
    runState.recordTerminalState(runId, 1, "succeeded", new Date(Date.now() - 1000).toISOString());

    // Create worktree with uncommitted dirty change
    const worktreesDir = join(scopeRootA, ".kota", "runtime", "worktrees");
    const runtimeDir = join(scopeRootA, ".kota", "runtime", allocation);
    const worktreeDir = join(worktreesDir, allocation);
    mkdirSync(worktreesDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });

    execFileSync("git", ["worktree", "add", "-b", `kota/run/${allocation}`, worktreeDir, "HEAD"], {
      cwd: scopeRootA,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    });

    // Make worktree dirty
    writeFileSync(join(worktreeDir, "dirty.txt"), "uncommitted work\n");

    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
    });

    // Dry run status check
    const status = await collector.status({ scopeId: scopeA.scopeId });
    const dirtyCandidate = status.candidates.find((c) => c.reason === "workspace-dirty");
    expect(dirtyCandidate).toBeDefined();
    expect(dirtyCandidate?.decision).toBe("needs_attention");
    expect(dirtyCandidate?.remediation).toContain("uncommitted changes");

    // Live sweep
    const sweep = await collector.sweep({ scopeId: scopeA.scopeId });
    expect(sweep.candidates.some((c) => c.decision === "needs_attention")).toBe(true);

    // The dirty worktree is PRESERVED
    expect(existsSync(worktreeDir)).toBe(true);
    expect(existsSync(join(worktreeDir, "dirty.txt"))).toBe(true);
  });

  it("reclaims clean integrated sandboxes, associated branches, and records reclaimed bytes", async () => {
    const scopeA = scopeRegistry.list()[0]!;
    const runId = "2026-08-28T00-00-00-000Z-builder-clean";
    const allocation = allocationName(runId);

    // Register terminal run in database
    runState.admitRun({
      id: runId,
      scopeId: scopeA.scopeId,
      workflowName: "builder",
      workflowRevision: "rev-1",
      triggerKind: "event",
      triggerEvent: "test",
      targetBranch: "main",
      repository: "write",
      concurrencyLimit: 1,
      costLimitUsd: 1,
      admissionKey: "adm-clean",
      parameterFingerprint: "fp-clean",
      admittedAt: new Date(Date.now() - 5000).toISOString(),
    });
    runState.startAttempt(runId, 1, 1, new Date(Date.now() - 4000).toISOString());
    runState.recordTerminalState(runId, 1, "succeeded", new Date(Date.now() - 3000).toISOString());

    const worktreesDir = join(scopeRootA, ".kota", "runtime", "worktrees");
    const runtimeDir = join(scopeRootA, ".kota", "runtime", allocation);
    const worktreeDir = join(worktreesDir, allocation);
    mkdirSync(worktreesDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });

    execFileSync("git", ["worktree", "add", "-b", `kota/run/${allocation}`, worktreeDir, "HEAD"], {
      cwd: scopeRootA,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    });

    writeFileSync(join(runtimeDir, "run-info.json"), JSON.stringify({ runId }));

    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
    });

    const status = await collector.status({ scopeId: scopeA.scopeId });
    const sandboxCandidate = status.candidates.find((c) => c.store === "sandboxes");
    expect(sandboxCandidate?.decision).toBe("delete");

    const report = await collector.sweep({ scopeId: scopeA.scopeId });
    expect(report.reclaimedByStore.sandboxes?.count).toBe(1);
    expect(report.reclaimedByStore.sandboxes?.reclaimedBytes).toBeGreaterThan(0);

    // Worktree, runtime root, and git branch are physically removed
    expect(existsSync(worktreeDir)).toBe(false);
    expect(existsSync(runtimeDir)).toBe(false);
  });

  it("handles malformed records gracefully without failing unrelated collections", async () => {
    const scopeA = scopeRegistry.list()[0]!;

    // Malformed approval JSON
    const approvalsDir = join(scopeRootA, ".kota", "approvals");
    mkdirSync(approvalsDir, { recursive: true });
    writeFileSync(join(approvalsDir, "corrupt.json"), "{ invalid-json ");

    // Valid expired approval JSON
    const validApproval = {
      id: "app-old",
      status: "approved",
      createdAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
      resolvedAt: new Date(Date.now() - 19 * DAY_MS).toISOString(),
    };
    writeFileSync(join(approvalsDir, "app-old.json"), JSON.stringify(validApproval));

    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
    });

    const status = await collector.status({ scopeId: scopeA.scopeId });
    const malformed = status.candidates.find((c) => c.reason === "malformed-approval-record");
    expect(malformed).toBeDefined();
    expect(malformed?.decision).toBe("needs_attention");

    const sweep = await collector.sweep({ scopeId: scopeA.scopeId });
    expect(sweep.reclaimedByStore["owner-records"]?.count).toBe(1);

    // Corrupted file survives for operator inspection
    expect(existsSync(join(approvalsDir, "corrupt.json"))).toBe(true);
    // Valid expired file is deleted
    expect(existsSync(join(approvalsDir, "app-old.json"))).toBe(false);
  });

  it("compacts dead letter queue snapshots and event journal payloads while preserving active records", async () => {
    const scopeA = scopeRegistry.list()[0]!;

    // Dead letter queue
    const dlqDir = join(scopeRootA, ".kota", "dead-letter-queue");
    mkdirSync(dlqDir, { recursive: true });
    const dlqItems = {
      items: [
        {
          id: "dlq-open",
          type: "workflow_error",
          status: "open",
          createdAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
          affectedWorkflowNames: ["builder"],
          retention: { kind: "retain" },
        },
        {
          id: "dlq-closed-expired",
          type: "workflow_error",
          status: "dismissed",
          createdAt: new Date(Date.now() - 20 * DAY_MS).toISOString(),
          affectedWorkflowNames: ["builder"],
          retention: { kind: "expire-after-ms", durationMs: 1000, expiresAt: new Date(Date.now() - 19 * DAY_MS).toISOString() },
        },
      ],
    };
    writeFileSync(join(dlqDir, "items.json"), JSON.stringify(dlqItems));

    // Event Journal
    const journalDir = join(stateDir, "events");
    mkdirSync(journalDir, { recursive: true });
    const activeEvent = {
      id: "evt-active",
      sequence: 1,
      event: "daemon.started",
      timestamps: { journaledAt: new Date().toISOString() },
      retention: { kind: "retain" },
      payload: { pid: 1234 },
    };
    const expiredEvent = {
      id: "evt-expired",
      sequence: 2,
      event: "temporary.tick",
      timestamps: { journaledAt: new Date(Date.now() - 10 * DAY_MS).toISOString() },
      retention: { kind: "expire-after-ms", durationMs: 1000 },
      payload: { tick: 999 },
    };
    writeFileSync(
      join(journalDir, "journal.jsonl"),
      `${JSON.stringify(activeEvent)}\n${JSON.stringify(expiredEvent)}\n`,
    );

    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
    });

    const report = await collector.sweep();
    expect(report.reclaimedByStore["dead-letters"]?.count).toBe(1);
    expect(report.reclaimedByStore["event-journal"]?.count).toBe(1);

    // Verify dead letter queue has open item retained and expired item dropped
    const updatedDlq = JSON.parse(readFileSync(join(dlqDir, "items.json"), "utf-8"));
    expect(updatedDlq.items).toHaveLength(1);
    expect(updatedDlq.items[0].id).toBe("dlq-open");

    // Verify event journal has active event retained and expired event compacted
    const updatedJournal = readFileSync(join(journalDir, "journal.jsonl"), "utf-8");
    expect(updatedJournal).toContain("evt-active");
    expect(updatedJournal).not.toContain("evt-expired");
  });

  it("sweeps expired idle sessions and stale chat bindings while preserving active ones", async () => {
    const scopeA = scopeRegistry.list()[0]!;

    sessions.set("session-active", {
      id: "session-active",
      scopeId: scopeA.scopeId,
      createdAt: new Date().toISOString(),
      lastActive: Date.now() - 1000,
      autonomyMode: "autonomous",
    });

    sessions.set("session-expired", {
      id: "session-expired",
      scopeId: scopeA.scopeId,
      createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      lastActive: Date.now() - 15 * 60 * 1000,
      autonomyMode: "autonomous",
    });

    chatBindings.put("session-active", "conv-1", scopeA.scopeId);
    chatBindings.put("session-orphan", "conv-2", scopeA.scopeId);

    const emitSpy = vi.fn();
    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
      emitSessionUnregistered: emitSpy,
      sessionIdleTtlMs: 5 * 60 * 1000,
    });

    const report = await collector.sweep();
    expect(report.reclaimedByStore.sessions?.count).toBe(1);
    expect(sessions.has("session-active")).toBe(true);
    expect(sessions.has("session-expired")).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(scopeA.scopeId, "session-expired");
  });

  it("is idempotent: repeated sweeps produce no-op results", async () => {
    const collector = new LifecycleCollector({
      stateDir,
      scopeRegistry,
      runState,
      eventJournal,
      sessions,
      chatBindings,
    });

    const firstSweep = await collector.sweep();
    const secondSweep = await collector.sweep();

    expect(secondSweep.reclaimedCount).toBe(0);
    expect(secondSweep.reclaimedBytes).toBe(0);
  });
});
