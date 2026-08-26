import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ControlMonitorCoverageArtifact } from "./control-monitor-coverage.js";
import type { IntegrationContinuation } from "./run-lifecycle.js";
import { RunLifecycle, type WorkflowContextExecutor } from "./run-lifecycle.js";
import { type RepositoryAccess, RunSandboxManager } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";
import type { StoredRun } from "./run-state-types.js";
import {
  readWriterIntegrationEvidence,
  writerIntegrationEvidencePath,
} from "./writer-integration-evidence.js";

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
  store.registerProject({
    id: `project-${label}`,
    rootPath: root,
    createdAt: "2026-08-25T09:00:00.000Z",
  });
  const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
  store.admitRun({
    id: `run-${label}`,
    projectId: `project-${label}`,
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
  });
}

afterEach(() => {
  for (const value of fixtures.splice(0)) {
    value.store.close();
    rmSync(value.root, { force: true, recursive: true });
  }
});

describe("RunLifecycle", () => {
  test("gives a reader an isolated checkout, durable effects, and safe cleanup", async () => {
    const value = fixture("reader", "read");
    let effectCalls = 0;
    let workspace = "";

    const outcome = await lifecycle(value, async (context) => {
      workspace = context.sandbox.workspaceDir;
      expect(context.run).toEqual({ id: value.run.id, attempt: 1, daemonEpoch: 1 });
      expect(context.project.root).toBe(value.root);
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
    expect(value.store.getRun(value.run.id)?.integration).toMatchObject({
      phase: "merged",
      publishedHead: git(value.root, "rev-parse", "HEAD"),
    });
    expect(value.store.getRun(value.run.id)?.sandbox).toBeUndefined();
    expect(existsSync(workspace)).toBe(false);
    expect(
      readWriterIntegrationEvidence(join(value.root, ".kota", "runs"), value.run.id),
    ).toMatchObject({
      version: 1,
      runId: value.run.id,
      workflow: "example",
      projectId: value.run.projectId,
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

  test("records an empty writer without attributing the existing head commit", async () => {
    const value = fixture("empty-writer", "write");

    const outcome = await lifecycle(value, async () => ({
      kind: "completed",
      commitMessage: "nothing to publish",
    })).execute(value.run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
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

  test("finishes after a crash between physical cleanup and clearing durable sandbox state", async () => {
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

    const outcome = await lifecycle(value, async () => {
      throw new Error("published writer must not execute again");
    }).execute(value.store.getRun(value.run.id)!, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(value.store.getRun(value.run.id)?.integration).toMatchObject({
      phase: "merged",
      publishedHead,
    });
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

  test("rebases over a concurrent canonical advance before publication", async () => {
    const value = fixture("advance", "write");

    const outcome = await lifecycle(value, async (context) => {
      write(context.sandbox.workspaceDir, "writer.txt", "writer\n");
      write(value.root, "canonical.txt", "canonical\n");
      commit(value.root, "canonical advance");
      return { kind: "completed", commitMessage: "writer change" };
    }).execute(value.run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(readFileSync(join(value.root, "writer.txt"), "utf8")).toBe("writer\n");
    expect(git(value.root, "log", "--format=%s", "-3").split("\n")).toEqual([
      "writer change",
      "canonical advance",
      "base",
    ]);
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
    }).execute(recovered, new AbortController().signal);

    expect(second).toMatchObject({ state: "needs_attention" });
    expect(adoptedWorkspace).toBe(firstWorkspace);
    expect(existsSync(firstWorkspace)).toBe(true);
  });
});
