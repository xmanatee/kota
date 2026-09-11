import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import type { ControlMonitorCoverageArtifact } from "./control-monitor-coverage.js";
import { RunCoordinator } from "./run-coordinator.js";
import { withWorkflowFinalization } from "./run-finalization.js";
import type { IntegrationContinuation } from "./run-lifecycle.js";
import { RunLifecycle, type WorkflowContextExecutor } from "./run-lifecycle.js";
import { RunResourceAllocator } from "./run-resources.js";
import { type RepositoryAccess, RunSandboxManager } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { StoredRun } from "./run-state-types.js";
import { WorkflowRuntime } from "./runtime.js";
import type { WorkflowFinalizationContext } from "./types.js";
import {
  readWriterIntegrationEvidence,
  writerIntegrationEvidencePath,
} from "./writer-integration-evidence.js";

// Runtime composition creates its own allocator; control only the external
// listener probe, just as the direct lifecycle fixture below does.
vi.mock("./run-resources.js", async (original) => {
  const actual = await original<typeof import("./run-resources.js")>();
  return {
    ...actual,
    RunResourceAllocator: class extends actual.RunResourceAllocator {
      constructor(store: RunStateDatabase, options: import("./run-resources.js").RunResourceAllocatorOptions) {
        super(store, { ...options, isPortAvailable: async () => true });
      }
    },
  };
});

type Fixture = {
  root: string;
  store: RunStateDatabase;
  epoch: number;
  run: StoredRun;
};

const fixtures: Fixture[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function commit(root: string, message: string): string {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function fixture(label: string, repository: RepositoryAccess): Fixture {
  const root = mkdtempSync(join(tmpdir(), `kota-lifecycle-${label}-`));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "KOTA Test");
  git(root, "config", "user.email", "kota@example.test");
  git(root, "config", "commit.gpgsign", "false");
  write(root, ".gitignore", ".kota/\n.worktrees/\n");
  write(root, "shared.txt", "base\n");
  commit(root, "base");

  const store = new RunStateDatabase(join(root, ".kota", "state"));
  store.registerScope({
    id: `scope-${label}`,
    rootPath: root,
    createdAt: "2026-08-25T09:00:00.000Z",
  });
  const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
  store.admitRun({
    id: `run-${label}`,
    scopeId: `scope-${label}`,
    workflow: "example",
    repository,
    trigger: { event: "example.ready", schemaRef: null, payload: { label } },
    resources: [],
    admittedAt: "2026-08-25T10:00:01.000Z",
  });
  store.startRun(`run-${label}`, epoch, "2026-08-25T10:00:02.000Z");
  const result = { root, store, epoch, run: store.getRun(`run-${label}`)! };
  fixtures.push(result);
  return result;
}

function lifecycle(
  value: Fixture,
  executeWorkflow: WorkflowContextExecutor,
  continueIntegration: IntegrationContinuation = async () => undefined,
): RunLifecycle {
  return new RunLifecycle({
    store: value.store,
    daemonEpoch: value.epoch,
    executeWorkflow,
    continueIntegration,
    validate: async () => ({ status: "passed", evidence: ["verified"] }),
    createResourceAllocator,
  });
}

function createResourceAllocator(store: RunStateDatabase): RunResourceAllocator {
  return new RunResourceAllocator(store, {
    portStart: 41_000,
    portEnd: 41_003,
    portRangeSize: 4,
    isPortAvailable: async () => true,
  });
}

afterEach(() => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    rmSync(value.root, { force: true, recursive: true });
  }
});

describe("RunLifecycle", () => {
  test.each([false, true])("reexecutes a semantically rejected writer in its retained sandbox (changed: %s)", async (changed) => {
    const value = fixture(`semantic-retry-${changed}`, "write");
    let accepted = false;
    let workspace = "";
    const runtime = new RunLifecycle({
      store: value.store,
      daemonEpoch: value.epoch,
      executeWorkflow: async (context) => {
        if (workspace) {
          expect(context.sandbox.workspaceDir).toBe(workspace);
          if (changed) expect(readFileSync(join(workspace, "feature.txt"), "utf8")).toBe("retained work\n");
          accepted = true;
        }
        workspace = context.sandbox.workspaceDir;
        if (changed) write(workspace, "feature.txt", "retained work\n");
        return { kind: "completed" };
      },
      validate: async () => ({ status: "passed", evidence: ["verified"] }),
      verifyPostReconcile: () => accepted
        ? { satisfied: true }
        : { satisfied: false, reason: "required review is missing" },
      continueIntegration: async () => { throw new Error("merge repair cannot replace workflow review"); },
      createResourceAllocator,
    });
    const rejected = await runtime.execute(value.run, new AbortController().signal);
    expect(rejected.kind).toBe("suspended");
    if (rejected.kind !== "suspended") throw new Error("expected semantic rejection");
    expect(existsSync(join(value.root, "feature.txt"))).toBe(false);
    value.store.suspendRun({ runId: value.run.id, epoch: value.epoch,
      state: rejected.state, wait: rejected.wait, error: rejected.error,
      suspendedAt: "2026-08-25T10:00:03.000Z" });
    value.store.resumeRun(value.run.id, "2026-08-25T10:00:04.000Z");
    value.store.startRun(value.run.id, value.epoch, "2026-08-25T10:00:05.000Z");
    expect(await runtime.execute(value.store.getRun(value.run.id)!, new AbortController().signal))
      .toEqual({ kind: "terminal", state: "succeeded" });
    expect(accepted).toBe(true);
    if (changed) expect(readFileSync(join(value.root, "feature.txt"), "utf8")).toBe("retained work\n");
    expect(existsSync(workspace)).toBe(false);
  });

  test("gives a reader an isolated checkout, durable effects, and safe cleanup", async () => {
    const value = fixture("reader", "read");
    let effectCalls = 0;
    let workspace = "";

    const outcome = await lifecycle(value, async (context) => {
      workspace = context.sandbox.workspaceDir;
      expect(context.run).toEqual({ id: value.run.id, attempt: 1, daemonEpoch: 1 });
      expect(context.scope.root).toBe(value.root);
      const invoke = () =>
        context.effects.execute({
          key: "lookup",
          requestFingerprint: "request-v1",
          execute: async () => {
            effectCalls += 1;
            return { answer: 42 } as const;
          },
        });
      expect(await invoke()).toEqual({ answer: 42 });
      expect(await invoke()).toEqual({ answer: 42 });
      return { kind: "completed" };
    }).execute(value.run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(effectCalls).toBe(1);
    expect(existsSync(workspace)).toBe(false);
  });

  test("owns the writer commit, publishes it, and cleans the sandbox", async () => {
    const value = fixture("publish", "write");
    let workspace = "";
    write(
      value.root,
      `.kota/runs/${value.run.id}/metadata.json`,
      `${JSON.stringify({
        id: value.run.id,
        workflow: value.run.workflow,
        definitionPath: "workflow.ts",
        trigger: value.run.trigger,
        startedAt: "2026-08-25T10:00:02.000Z",
        completedAt: "2026-08-25T10:00:03.000Z",
        durationMs: 1_000,
        status: "success",
        runDir: `.kota/runs/${value.run.id}`,
        steps: [],
      })}\n`,
    );

    const outcome = await lifecycle(value, async (context) => {
      workspace = context.sandbox.workspaceDir;
      write(context.sandbox.workspaceDir, "feature.txt", "delivered\n");
      return { kind: "completed", commitMessage: "deliver feature" };
    }).execute(value.run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(readFileSync(join(value.root, "feature.txt"), "utf8")).toBe("delivered\n");
    expect(git(value.root, "log", "-1", "--format=%s")).toBe("deliver feature");
    expect(value.store.getRun(value.run.id)?.sandbox).toBeUndefined();
    expect(existsSync(workspace)).toBe(false);
    expect(
      readWriterIntegrationEvidence(join(value.root, ".kota", "runs"), value.run.id),
    ).toMatchObject({
      version: 1,
      runId: value.run.id,
      workflow: "example",
      scopeId: value.run.scopeId,
      targetBranch: "main",
      publishedHead: git(value.root, "rev-parse", "HEAD"),
      commitSubject: "deliver feature",
      commitMessage: "deliver feature",
      changedPaths: ["feature.txt"],
    });
    const coverage = JSON.parse(
      readFileSync(
        join(
          value.root,
          ".kota",
          "runs",
          value.run.id,
          "control-monitor-coverage.json",
        ),
        "utf8",
      ),
    ) as ControlMonitorCoverageArtifact;
    expect(coverage.run.headSha).toBe(git(value.root, "rev-parse", "HEAD"));
  });

  test("finishes an empty writer without entering integration or touching canonical work", async () => {
    const value = fixture("empty-writer", "write");
    let validations = 0;
    let invariants = 0;
    write(value.root, "owner.txt", "owner work\n");

    const outcome = await new RunLifecycle({
      store: value.store,
      daemonEpoch: value.epoch,
      executeWorkflow: async () => ({
        kind: "completed",
        commitMessage: "nothing to publish",
      }),
      continueIntegration: async () => undefined,
      validate: async () => {
        validations += 1;
        return { status: "passed", evidence: ["verified"] };
      },
      verifyPostReconcile: () => {
        invariants += 1;
        return { satisfied: true };
      },
      createResourceAllocator,
    }).execute(value.run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(validations).toBe(0);
    expect(invariants).toBe(1);
    expect(readFileSync(join(value.root, "owner.txt"), "utf8")).toBe("owner work\n");
    const evidence = readWriterIntegrationEvidence(
      join(value.root, ".kota", "runs"),
      value.run.id,
    );
    expect(evidence).toMatchObject({
      baseHead: git(value.root, "rev-parse", "HEAD"),
      integratedFromHead: git(value.root, "rev-parse", "HEAD"),
      publishedHead: git(value.root, "rev-parse", "HEAD"),
      commitSubject: null,
      commitMessage: null,
      changedPaths: [],
    });
  });

  test.each(["resume", "restart"] as const)("retries completed reader cleanup after %s without executing steps", async (recovery) => {
    const value = fixture(`reader-cleanup-${recovery}`, "read");
    let executions = 0;
    let workspace = "";
    const retainedOutput = join(value.root, ".kota", "runs", value.run.id, "retained.json");
    const executeWorkflow: WorkflowContextExecutor = async (context) => {
      executions += 1;
      workspace = context.sandbox.workspaceDir;
      write(workspace, "cleanup-blocker.txt", "retain until cleanup is resolved\n");
      write(value.root, `.kota/runs/${value.run.id}/retained.json`, '{"planned":true}\n');
      return { kind: "completed" };
    };
    const outcome = await lifecycle(value, executeWorkflow).execute(value.run, new AbortController().signal);
    expect(outcome).toMatchObject({ kind: "suspended", wait: { reason: "sandbox-cleanup-blocked" } });
    if (outcome.kind !== "suspended") throw new Error("Expected blocked cleanup");
    const receipt = value.store.getRun(value.run.id)?.executionCompletedAt;
    expect(receipt).toEqual(expect.any(String));
    expect(existsSync(workspace)).toBe(true);

    if (recovery === "resume") {
      value.store.suspendRun({
        runId: value.run.id, epoch: value.epoch, state: outcome.state,
        wait: outcome.wait, suspendedAt: "2026-08-25T10:00:03.000Z",
      });
      value.store.resumeRun(value.run.id, "2026-08-25T10:00:04.000Z");
    } else {
      value.store.close();
      value.store = RunStateDatabase.openExisting(join(value.root, ".kota", "state"));
      value.epoch = value.store.beginDaemonSession("2026-08-25T10:10:00.000Z").epoch;
      value.store.completeRestartRecovery(value.run.id, value.epoch, "2026-08-25T10:10:01.000Z");
    }
    rmSync(join(workspace, "cleanup-blocker.txt"));
    const runtime = lifecycle(value, executeWorkflow);
    const coordinator = new RunCoordinator({
      store: value.store, daemonEpoch: value.epoch, concurrency: 1,
      execute: (run, signal) => runtime.execute(run, signal),
    });
    try {
      coordinator.refill();
      await coordinator.whenIdle();
      expect(value.store.getRun(value.run.id)).toMatchObject({
        state: "succeeded", attempt: 2, executionCompletedAt: receipt,
      });
      expect(value.store.getRun(value.run.id)?.sandbox).toBeUndefined();
      expect(executions).toBe(1);
      expect(existsSync(workspace)).toBe(false);
      expect(readFileSync(retainedOutput, "utf8")).toBe('{"planned":true}\n');
    } finally {
      await coordinator.dispose();
    }
  });

  test.each([
    ["read", "resume"], ["read", "restart"],
    ["none", "resume"], ["none", "restart"],
  ] as const)("replays %s finalization after %s with the original outputs", async (repository, recovery) => {
    const value = fixture(`finalization-${repository}-${recovery}`, repository);
    const marker = join(value.root, ".kota", "local-completion");
    let executions = 0;
    let interrupt = true;
    const createHost = () => {
      const bus = new EventBus();
      let runtime!: WorkflowRuntime;
      const coordinator = new RunCoordinator({
        store: value.store, daemonEpoch: value.epoch, concurrency: 1,
        execute: (run, signal) => runtime.executeAdmittedRun(run, signal),
      });
      runtime = new WorkflowRuntime({
        bus, pbus: new ScopedEventBus(bus, value.run.scopeId), scopeRoot: value.root,
        scopeId: value.run.scopeId, runState: value.store,
        runCoordinator: coordinator, daemonEpoch: value.epoch,
        workflows: [{
          name: value.run.workflow, repository, moduleRoot: value.root,
          definitionPath: "finalization-fixture", triggers: [{ event: "manual" }],
          steps: [{
            id: "plan", type: "code", run: () => {
              executions += 1;
              return { planned: !existsSync(marker) };
            },
          }],
          finalize: (ctx) => {
            expect(value.store.getRun(ctx.runId)?.sandbox).toBeUndefined();
            expect(ctx.stepOutputs.plan).toEqual({ planned: true });
            if (!existsSync(marker)) writeFileSync(marker, ctx.runId);
            expect(readFileSync(marker, "utf8")).toBe(ctx.runId);
            ctx.state.compareAndSet("completed", 0, ctx.runId);
            ctx.emit("owner.completed", { runId: ctx.runId }, "finalize");
            if (interrupt) throw new Error("interrupted after local completion");
          },
        }],
      });
      runtime.reloadWorkflowDefinitions();
      return { runtime, coordinator };
    };
    let host = createHost();
    try {
      const outcome = await host.runtime.executeAdmittedRun(value.run, new AbortController().signal);
      expect(outcome).toMatchObject({ kind: "terminal", state: "succeeded" });
      if (outcome.kind !== "terminal") throw new Error("Expected lifecycle success");
      const receipt = value.store.getRun(value.run.id)?.executionCompletedAt;
      expect(receipt).toEqual(expect.any(String));
      expect(() => value.store.finishRun(
        value.run.id, value.epoch, outcome.state, "2026-08-25T10:00:03.000Z",
        outcome.error, outcome.publication, outcome.resultStatus, outcome.finalize,
      )).toThrow("interrupted after local completion");
      expect(value.store.readScopeStateValue(value.run.scopeId, "completed")).toEqual({ revision: 0, value: null });
      expect(value.store.listPendingPublications()).toEqual([]);

      if (recovery === "resume") {
        value.store.suspendRun({
          runId: value.run.id, epoch: value.epoch, state: "needs_attention",
          wait: { reason: "workflow-finalization-failed" }, suspendedAt: "2026-08-25T10:00:04.000Z",
        });
        value.store.resumeRun(value.run.id, "2026-08-25T10:00:05.000Z");
      } else {
        await host.runtime.stop();
        await host.coordinator.dispose();
        value.store.close();
        value.store = RunStateDatabase.openExisting(join(value.root, ".kota", "state"));
        value.epoch = value.store.beginDaemonSession("2026-08-25T10:10:00.000Z").epoch;
        value.store.completeRestartRecovery(value.run.id, value.epoch, "2026-08-25T10:10:01.000Z");
        host = createHost();
      }
      interrupt = false;
      host.coordinator.refill();
      await host.coordinator.whenIdle();
      expect(value.store.getRun(value.run.id)).toMatchObject({
        state: "succeeded", attempt: 2, executionCompletedAt: receipt,
      });
      expect(executions).toBe(1);
      expect(value.store.readScopeStateValue(value.run.scopeId, "completed")).toEqual({ revision: 1, value: value.run.id });
      expect(value.store.listPendingPublications().map((publication) => publication.event))
        .toEqual(["owner.completed", "workflow.completed"]);
    } finally {
      await host.runtime.stop();
      await host.coordinator.dispose();
    }
  });

  test("replays finalization after cleanup and a rolled-back success transaction without rerunning merged work", async () => {
    const value = fixture("cleanup-crash", "write");
    const manager = new RunSandboxManager(value.root);
    const sandbox = manager.create({ runId: value.run.id, repository: "write" });
    value.store.setSandbox(value.run.id, value.epoch, sandbox);
    write(sandbox.workspaceDir, "delivered.txt", "done\n");
    const baseHead = sandbox.baseCommit;
    commit(sandbox.workspaceDir, "delivered before cleanup crash");
    git(value.root, "merge", "--ff-only", git(sandbox.workspaceDir, "rev-parse", "HEAD"));
    value.store.beginIntegration(value.run.id, value.epoch, {
      contract: "run-lifecycle-v1",
      phase: "merged",
      commitMessage: "delivered before cleanup crash",
      baseHead,
      targetBranch: "main",
      fingerprints: [],
      integratedFromHead: baseHead,
      publishedHead: git(value.root, "rev-parse", "HEAD"),
      publishedCommitSubject: "delivered before cleanup crash",
      publishedCommitMessage: "delivered before cleanup crash",
      changedPaths: ["delivered.txt"],
      completedAt: "2026-08-25T10:00:03.000Z",
    });
    expect(manager.cleanup(sandbox)).toEqual({ cleaned: true, blockers: [] });
    rmSync(writerIntegrationEvidencePath(value.root, value.run.id), { force: true });
    expect(value.store.getRun(value.run.id)?.sandbox).toBeDefined();

    const outcome = await lifecycle(value, async () => {
      throw new Error("completed writer must not execute again");
    }).execute(value.store.getRun(value.run.id)!, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(value.store.getRun(value.run.id)?.sandbox).toBeUndefined();
    expect(
      readWriterIntegrationEvidence(join(value.root, ".kota", "runs"), value.run.id),
    ).toMatchObject({
      baseHead,
      publishedHead: git(value.root, "rev-parse", "HEAD"),
      changedPaths: ["delivered.txt"],
      completedAt: "2026-08-25T10:00:03.000Z",
    });

    let interrupt = true;
    const pbus = new ScopedEventBus(new EventBus(), value.run.scopeId);
    const marker = join(value.root, ".kota", "owner-completed");
    const definition = { finalize: (ctx: WorkflowFinalizationContext) => {
      expect(existsSync(sandbox.workspaceDir)).toBe(false);
      expect(readFileSync(join(ctx.scopeRoot, "delivered.txt"), "utf8")).toBe("done\n");
      if (!existsSync(marker)) writeFileSync(marker, ctx.runId);
      expect(readFileSync(marker, "utf8")).toBe(ctx.runId);
      ctx.state.compareAndSet("completed", 0, ctx.runId);
      ctx.emit("owner.completed", { runId: ctx.runId }, "finalize");
      if (interrupt) throw new Error("interrupted after local completion");
    } };
    const attached = withWorkflowFinalization(outcome, {
      definition, run: value.run, store: value.store, stateDir: join(value.root, ".kota"), pbus, stepOutputs: {},
    });
    if (attached.kind !== "terminal") throw new Error("Expected lifecycle success");
    expect(() => value.store.finishRun(
      value.run.id, value.epoch, "succeeded", "2026-08-25T10:00:04.000Z",
      undefined, undefined, undefined, attached.finalize,
    )).toThrow("interrupted after local completion");
    expect(value.store.readScopeStateValue(value.run.scopeId, "completed")).toEqual({ revision: 0, value: null });
    expect(value.store.listPendingPublications()).toEqual([]);

    const session = value.store.beginDaemonSession("2026-08-25T10:10:00.000Z");
    value.store.completeRestartRecovery(value.run.id, session.epoch, "2026-08-25T10:10:01.000Z");
    value.epoch = session.epoch;
    interrupt = false;
    const recovered = lifecycle(value, async () => {
      throw new Error("merged writer must not execute again");
    });
    const coordinator = new RunCoordinator({
      store: value.store, daemonEpoch: session.epoch, concurrency: 1,
      execute: async (run, signal) => withWorkflowFinalization(await recovered.execute(run, signal), {
        definition, run, store: value.store, stateDir: join(value.root, ".kota"), pbus, stepOutputs: {},
      }),
    });
    try {
      coordinator.refill();
      await coordinator.whenIdle();
      expect(value.store.getRun(value.run.id)).toMatchObject({ state: "succeeded", attempt: 2 });
      expect(value.store.readScopeStateValue(value.run.scopeId, "completed")).toEqual({ revision: 1, value: value.run.id });
      expect(value.store.listPendingPublications()).toEqual([
        expect.objectContaining({ event: "owner.completed", runId: value.run.id }),
      ]);
    } finally {
      await coordinator.dispose();
    }
  });

  test("recovers evidence after canonical publication before merge acknowledgement", async () => {
    const value = fixture("publication-crash", "write");
    const manager = new RunSandboxManager(value.root);
    const sandbox = manager.create({ runId: value.run.id, repository: "write" });
    value.store.setSandbox(value.run.id, value.epoch, sandbox);
    write(sandbox.workspaceDir, "published.txt", "durable\n");
    const baseHead = sandbox.baseCommit;
    const publishedHead = commit(sandbox.workspaceDir, "published before acknowledgement");
    value.store.beginIntegration(value.run.id, value.epoch, {
      contract: "run-lifecycle-v1",
      phase: "publishing",
      commitMessage: "published before acknowledgement",
      baseHead,
      targetBranch: "main",
      fingerprints: [],
      integratedFromHead: baseHead,
      publishedHead,
      publishedCommitSubject: "published before acknowledgement",
      publishedCommitMessage: "published before acknowledgement",
      changedPaths: ["published.txt"],
      completedAt: "2026-08-25T10:00:04.000Z",
    });
    git(value.root, "merge", "--ff-only", publishedHead);
    write(value.root, "later-writer.txt", "later\n");
    commit(value.root, "later canonical publication");
    expect(manager.cleanup(sandbox)).toEqual({ cleaned: true, blockers: [] });

    const session = value.store.beginDaemonSession("2026-08-25T10:10:00.000Z");
    value.store.completeRestartRecovery(
      value.run.id,
      session.epoch,
      "2026-08-25T10:10:00.500Z",
    );
    value.store.startRun(value.run.id, session.epoch, "2026-08-25T10:10:01.000Z");

    const outcome = await new RunLifecycle({
      store: value.store,
      daemonEpoch: session.epoch,
      executeWorkflow: async () => {
        throw new Error("published writer must not execute again");
      },
      continueIntegration: async () => undefined,
      validate: async () => ({ status: "passed", evidence: [] }),
      createResourceAllocator,
    }).execute(value.store.getRun(value.run.id)!, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(value.store.getRun(value.run.id)?.sandbox).toBeUndefined();
    expect(
      readWriterIntegrationEvidence(join(value.root, ".kota", "runs"), value.run.id),
    ).toMatchObject({
      baseHead,
      integratedFromHead: baseHead,
      publishedHead,
      changedPaths: ["published.txt"],
      completedAt: "2026-08-25T10:00:04.000Z",
    });
  });

  test("retries integration after transient canonical edits without losing the sandbox", async () => {
    const value = fixture("canonical-dirty", "write");
    let workspace = "";

    const outcome = await lifecycle(value, async (context) => {
      workspace = context.sandbox.workspaceDir;
      write(workspace, "writer.txt", "writer\n");
      write(value.root, "owner.txt", "not committed\n");
      return { kind: "completed", commitMessage: "writer change" };
    }).execute(value.run, new AbortController().signal);

    expect(outcome).toMatchObject({
      kind: "suspended",
      state: "waiting",
      wait: { reason: "integration-canonical-dirty" },
    });
    expect(outcome.kind === "suspended" && outcome.resumeAt).toBeDefined();
    expect(existsSync(workspace)).toBe(true);
    expect(git(value.root, "status", "--porcelain")).toContain("owner.txt");

    if (outcome.kind !== "suspended" || outcome.resumeAt === undefined) {
      throw new Error("expected a delayed integration retry");
    }
    value.store.deferRun({
      runId: value.run.id,
      epoch: value.epoch,
      deferredAt: "2026-08-25T10:00:03.000Z",
      resumeAt: outcome.resumeAt,
    });
    rmSync(join(value.root, "owner.txt"));
    value.store.startRun(value.run.id, value.epoch, outcome.resumeAt);
    let workflowReexecuted = false;
    const recovered = await lifecycle(value, async () => {
      workflowReexecuted = true;
      return { kind: "completed" };
    }).execute(value.store.getRun(value.run.id)!, new AbortController().signal);

    expect(recovered).toEqual({ kind: "terminal", state: "succeeded" });
    expect(workflowReexecuted).toBe(false);
    expect(existsSync(workspace)).toBe(false);
    expect(readFileSync(join(value.root, "writer.txt"), "utf8")).toBe("writer\n");
  });

  test("moves a rejected post-reconcile invariant to attention without discarding work", async () => {
    const value = fixture("invariant", "write");
    let workspace = "";
    const canonicalHead = git(value.root, "rev-parse", "HEAD");

    const outcome = await new RunLifecycle({
      store: value.store,
      daemonEpoch: value.epoch,
      executeWorkflow: async (context) => {
        workspace = context.sandbox.workspaceDir;
        write(workspace, "feature.txt", "preserve me\n");
        return { kind: "completed", commitMessage: "candidate feature" };
      },
      continueIntegration: async () => undefined,
      validate: async () => ({ status: "passed", evidence: ["verified"] }),
      verifyPostReconcile: () => ({
        satisfied: false,
        reason: "source contract changed after admission",
      }),
      createResourceAllocator,
    }).execute(value.run, new AbortController().signal);

    expect(outcome).toMatchObject({
      kind: "suspended",
      state: "needs_attention",
      wait: {
        reason: "integration-invariant-failed",
        evidence: ["source contract changed after admission"],
      },
    });
    expect(git(value.root, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(existsSync(join(value.root, "feature.txt"))).toBe(false);
    expect(existsSync(join(workspace, "feature.txt"))).toBe(true);
    expect(value.store.getRun(value.run.id)?.sandbox?.workspaceDir).toBe(workspace);
  });

  test(
    "preserves a writer sandbox when continuation checkpoint persistence needs attention",
    async () => {
      const value = fixture("continuation-checkpoint", "write");
      let workspace = "";

      const outcome = await lifecycle(value, async (context) => {
        workspace = context.sandbox.workspaceDir;
        write(workspace, "unpublished.txt", "preserve me\n");
        return {
          kind: "suspended",
          state: "needs_attention",
          wait: {
            kind: "continuation",
            decision: "decompose",
            checkpointFailure: "workflow artifact persistence failed",
          },
          error: "workflow artifact persistence failed",
        };
      }).execute(value.run, new AbortController().signal);

      expect(outcome).toMatchObject({
        kind: "suspended",
        state: "needs_attention",
        wait: { checkpointFailure: "workflow artifact persistence failed" },
      });
      expect(readFileSync(join(workspace, "unpublished.txt"), "utf8")).toBe(
        "preserve me\n",
      );
      expect(value.store.getRun(value.run.id)?.sandbox?.workspaceDir).toBe(
        workspace,
      );
    },
  );

  test("lets AI edit a conflict while runtime owns rebase continuation", async () => {
    const value = fixture("conflict", "write");
    const issues: string[] = [];

    const outcome = await lifecycle(
      value,
      async (context) => {
        write(context.sandbox.workspaceDir, "shared.txt", "writer\n");
        write(value.root, "shared.txt", "canonical\n");
        commit(value.root, "canonical change");
        return { kind: "completed", commitMessage: "writer change" };
      },
      async (context, issue) => {
        issues.push(issue.kind);
        write(context.sandbox.workspaceDir, "shared.txt", "canonical + writer\n");
      },
    ).execute(value.run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(issues).toEqual(["conflict"]);
    expect(readFileSync(join(value.root, "shared.txt"), "utf8")).toBe(
      "canonical + writer\n",
    );
  });

  test("stops unchanged conflict continuations for owner attention", async () => {
    const value = fixture("no-progress", "write");

    const outcome = await lifecycle(
      value,
      async (context) => {
        write(context.sandbox.workspaceDir, "shared.txt", "writer\n");
        write(value.root, "shared.txt", "canonical\n");
        commit(value.root, "canonical change");
        return { kind: "completed", commitMessage: "writer change" };
      },
      async () => undefined,
    ).execute(value.run, new AbortController().signal);

    expect(outcome).toMatchObject({
      kind: "suspended",
      state: "needs_attention",
      wait: { reason: "integration-no-progress" },
    });
    expect(existsSync(value.store.getRun(value.run.id)!.sandbox!.workspaceDir)).toBe(true);
    expect(git(value.root, "status", "--porcelain")).toBe("");
  });

  test("preserves failed writer work and adopts it after daemon restart", async () => {
    const value = fixture("restart", "write");
    let firstWorkspace = "";
    const first = await lifecycle(value, async (context) => {
      firstWorkspace = context.sandbox.workspaceDir;
      write(firstWorkspace, "partial.txt", "recover me\n");
      return { kind: "terminal", state: "failed", error: "provider disconnected" };
    }).execute(value.run, new AbortController().signal);
    expect(first).toMatchObject({ state: "needs_attention" });
    expect(existsSync(firstWorkspace)).toBe(true);

    const session = value.store.beginDaemonSession("2026-08-25T10:10:00.000Z");
    value.store.completeRestartRecovery(
      value.run.id,
      session.epoch,
      "2026-08-25T10:10:00.500Z",
    );
    value.store.startRun(value.run.id, session.epoch, "2026-08-25T10:10:01.000Z");
    const recovered = value.store.getRun(value.run.id)!;
    let adoptedWorkspace = "";
    const second = await new RunLifecycle({
      store: value.store,
      daemonEpoch: session.epoch,
      executeWorkflow: async (context) => {
        adoptedWorkspace = context.sandbox.workspaceDir;
        expect(readFileSync(join(adoptedWorkspace, "partial.txt"), "utf8")).toBe(
          "recover me\n",
        );
        return { kind: "terminal", state: "failed", error: "preserved" };
      },
      continueIntegration: async () => undefined,
      validate: async () => ({ status: "passed", evidence: [] }),
      createResourceAllocator,
    }).execute(recovered, new AbortController().signal);

    expect(second).toMatchObject({ state: "needs_attention" });
    expect(adoptedWorkspace).toBe(firstWorkspace);
    expect(existsSync(firstWorkspace)).toBe(true);
  });
});
