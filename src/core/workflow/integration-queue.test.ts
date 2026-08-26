import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { IntegrationQueue } from "./integration-queue.js";
import type { RunSandbox } from "./run-sandbox.js";
import { RunSandboxManager } from "./run-sandbox.js";
import { RunStateDatabase } from "./run-state-database.js";

const roots: string[] = [];
const stores: RunStateDatabase[] = [];

type WriteRunSandbox = Extract<RunSandbox, { repository: "write" }>;

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

function commit(repo: string, message: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function createFixture(label: string): {
  projectDir: string;
  projectId: string;
  sandbox: WriteRunSandbox;
  store: RunStateDatabase;
  epoch: number;
} {
  const projectDir = mkdtempSync(join(tmpdir(), `kota-integration-${label}-`));
  roots.push(projectDir);
  git(projectDir, "init", "-q", "-b", "main");
  git(projectDir, "config", "user.name", "KOTA Test");
  git(projectDir, "config", "user.email", "kota@example.test");
  git(projectDir, "config", "commit.gpgsign", "false");
  write(projectDir, ".gitignore", ".kota/\n.worktrees/\n");
  write(projectDir, "shared.txt", "base\n");
  commit(projectDir, "base");

  const sandbox = new RunSandboxManager(projectDir).create({
    runId: `run-${label}`,
    repository: "write",
  }) as WriteRunSandbox;
  const projectId = `project-${label}`;
  const store = new RunStateDatabase(join(projectDir, ".kota", "state"));
  stores.push(store);
  store.registerProject({
    id: projectId,
    rootPath: projectDir,
    createdAt: "2026-08-25T09:00:00.000Z",
  });
  const { epoch } = store.beginDaemonSession("2026-08-25T10:00:00.000Z");
  store.admitRun({
    id: sandbox.runId,
    projectId,
    workflow: "builder",
    repository: "write",
    trigger: { event: "task.ready", schemaRef: null, payload: { label } },
    resources: [],
    admittedAt: "2026-08-25T10:00:01.000Z",
  });
  store.startRun(sandbox.runId, epoch, "2026-08-25T10:00:02.000Z");
  return { projectDir, projectId, sandbox, store, epoch };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("IntegrationQueue", () => {
  test("rebases a writer over a nonconflicting canonical advance before validation and publication", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("advance");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    write(projectDir, "canonical.txt", "canonical\n");
    const canonicalHead = commit(projectDir, "canonical change");
    const queue = new IntegrationQueue(projectDir, store);
    let validatedHead = "";
    const finalizationOrder: string[] = [];

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        finalizationOrder.push("validate");
        validatedHead = input.head;
        expect(input).toMatchObject({
          workspaceDir: sandbox.workspaceDir,
          canonicalHead,
        });
        expect(git(input.workspaceDir, "rev-parse", "HEAD")).toBe(input.head);
        expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
        return { status: "passed", evidence: ["focused checks passed"] };
      },
      verifyPostReconcile: (input) => {
        finalizationOrder.push("invariant");
        expect(input).toMatchObject({
          workspaceDir: sandbox.workspaceDir,
          head: validatedHead,
          canonicalHead,
        });
        expect(store.getRun(sandbox.runId)?.resources).toEqual([
          "repo:primary:integration",
        ]);
        return { satisfied: true };
      },
      beforePublish: () => {
        finalizationOrder.push("publish");
      },
    });

    expect(result).toEqual({
      status: "merged",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead: validatedHead,
      publishedHead: validatedHead,
      validationEvidence: ["focused checks passed"],
      resourceKey: "repo:primary:integration",
    });
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(validatedHead);
    expect(git(projectDir, "log", "--format=%s", "-3").split("\n")).toEqual([
      "writer change",
      "canonical change",
      "base",
    ]);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
    expect(finalizationOrder).toEqual(["validate", "invariant", "publish"]);
  });

  test("preserves reconciled work when a post-reconcile invariant rejects publication", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("invariant");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    write(projectDir, "canonical.txt", "canonical\n");
    const canonicalHead = commit(projectDir, "canonical change");
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";
    let publishStarted = false;

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        return { status: "passed", evidence: ["focused checks passed"] };
      },
      verifyPostReconcile: (input) => {
        expect(git(input.workspaceDir, "rev-parse", "HEAD")).toBe(input.head);
        expect(input.canonicalHead).toBe(canonicalHead);
        return { satisfied: false, reason: "admitted contract changed" };
      },
      beforePublish: () => {
        publishStarted = true;
      },
    });

    expect(result).toEqual({
      status: "invariant-failed",
      reason: "admitted contract changed",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      validationEvidence: ["focused checks passed"],
      resourceKey: "repo:primary:integration",
    });
    expect(publishStarted).toBe(false);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(git(sandbox.workspaceDir, "rev-parse", "HEAD")).toBe(reconciledHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("returns stale when canonical moves during validation", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("stale");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";
    let observedCanonicalHead = "";

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
        write(projectDir, "late.txt", "late canonical change\n");
        observedCanonicalHead = commit(projectDir, "late canonical change");
        return { status: "passed", evidence: ["validated before canonical moved"] };
      },
    });

    expect(result).toEqual({
      status: "stale",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      observedCanonicalHead,
      validationEvidence: ["validated before canonical moved"],
      resourceKey: "repo:primary:integration",
    });
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(observedCanonicalHead);
    expect(() =>
      git(projectDir, "merge-base", "--is-ancestor", reconciledHead, "HEAD"),
    ).toThrow();
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("preserves an ordinary rebase conflict for a caller to resolve", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("conflict");
    write(sandbox.workspaceDir, "shared.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    write(projectDir, "shared.txt", "canonical\n");
    const canonicalHead = commit(projectDir, "canonical change");
    const queue = new IntegrationQueue(projectDir, store);
    let validationCalled = false;

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async () => {
        validationCalled = true;
        return { status: "passed", evidence: ["should not run"] };
      },
    });

    expect(result).toMatchObject({
      status: "conflicted",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      stoppedHead: canonicalHead,
      conflictPaths: ["shared.txt"],
    });
    expect(result.status === "conflicted" && result.rebaseOutput).toContain(
      "CONFLICT",
    );
    expect(validationCalled).toBe(false);
    expect(git(sandbox.workspaceDir, "rev-parse", "REBASE_HEAD")).toBe(writerHead);
    expect(git(sandbox.workspaceDir, "diff", "--name-only", "--diff-filter=U")).toBe(
      "shared.txt",
    );
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("returns validation-failed without publishing the reconciled head", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("validation");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    write(projectDir, "canonical.txt", "canonical\n");
    const canonicalHead = commit(projectDir, "canonical change");
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
        return {
          status: "failed",
          evidence: ["typecheck failed", "src/example.ts:1:1 TS2322"],
        };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "validation",
      reason: "validator-rejected",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      validationEvidence: ["typecheck failed", "src/example.ts:1:1 TS2322"],
    });
    expect(git(sandbox.workspaceDir, "rev-parse", "HEAD")).toBe(reconciledHead);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("returns busy without releasing another run's integration resource", async () => {
    const { projectDir, projectId, sandbox, store, epoch } = createFixture("busy");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    store.admitRun({
      id: "publication-owner",
      projectId,
      workflow: "builder",
      repository: "write",
      trigger: { event: "task.ready", schemaRef: null, payload: { label: "owner" } },
      resources: ["repo:primary:integration"],
      admittedAt: "2026-08-25T10:00:03.000Z",
    });
    expect(
      store.startRun("publication-owner", epoch, "2026-08-25T10:00:04.000Z"),
    ).toBe(1);
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        return { status: "passed", evidence: ["focused checks passed"] };
      },
    });

    expect(result).toEqual({
      status: "busy",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      validationEvidence: ["focused checks passed"],
      resourceKey: "repo:primary:integration",
    });
    expect(store.getRun("publication-owner")?.resources).toEqual([
      "repo:primary:integration",
    ]);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
  });

  test("refuses a dirty writer workspace before reconciliation", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("dirty-writer");
    write(sandbox.workspaceDir, "shared.txt", "uncommitted writer change\n");
    const writerHead = git(sandbox.workspaceDir, "rev-parse", "HEAD");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const queue = new IntegrationQueue(projectDir, store);
    let validationCalled = false;

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async () => {
        validationCalled = true;
        return { status: "passed", evidence: ["should not run"] };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "precondition",
      reason: "workspace-dirty",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      dirtyStatus: " M shared.txt",
    });
    expect(validationCalled).toBe(false);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("refuses a dirty canonical workspace before reconciliation", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("dirty-canonical");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    write(projectDir, "shared.txt", "uncommitted canonical change\n");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const queue = new IntegrationQueue(projectDir, store);
    let validationCalled = false;

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async () => {
        validationCalled = true;
        return { status: "passed", evidence: ["should not run"] };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "precondition",
      reason: "canonical-dirty",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      dirtyStatus: " M shared.txt",
    });
    expect(validationCalled).toBe(false);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("refuses writer changes left behind by validation", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("validator-dirty");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        write(input.workspaceDir, "shared.txt", "validation side effect\n");
        return { status: "passed", evidence: ["checks passed before side effect"] };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "validation",
      reason: "workspace-dirty",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      validationEvidence: ["checks passed before side effect"],
      dirtyStatus: " M shared.txt",
    });
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("refuses canonical changes made during validation and releases the lock", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("canonical-during-validation");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        write(projectDir, "shared.txt", "canonical validation side effect\n");
        return { status: "passed", evidence: ["focused checks passed"] };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "publication",
      reason: "canonical-dirty",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      validationEvidence: ["focused checks passed"],
      dirtyStatus: " M shared.txt",
      resourceKey: "repo:primary:integration",
    });
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("refuses a clean writer head that moved during validation", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("validator-head-moved");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const queue = new IntegrationQueue(projectDir, store);
    let reconciledHead = "";
    let observedWorkspaceHead = "";

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async (input) => {
        reconciledHead = input.head;
        write(input.workspaceDir, "after-validation.txt", "new commit\n");
        observedWorkspaceHead = commit(input.workspaceDir, "validation side effect");
        return { status: "passed", evidence: ["validated original head"] };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "validation",
      reason: "workspace-head-moved",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: sandbox.targetBranch,
      writerHead,
      canonicalHead,
      reconciledHead,
      observedWorkspaceHead,
      validationEvidence: ["validated original head"],
    });
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("never publishes a writer cancelled during validation", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("cancelled-validation");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    const controller = new AbortController();
    const queue = new IntegrationQueue(projectDir, store);

    await expect(
      queue.integrate({
        repositoryId: "primary",
        sandbox,
        epoch,
        signal: controller.signal,
        validate: async () => {
          controller.abort(new Error("operator cancelled run"));
          return { status: "passed", evidence: ["validation completed"] };
        },
      }),
    ).rejects.toThrow("operator cancelled run");

    expect(git(projectDir, "rev-parse", "HEAD")).toBe(canonicalHead);
    expect(store.getRun(sandbox.runId)?.resources).toEqual([]);
  });

  test("never publishes a writer into a different canonical branch", async () => {
    const { projectDir, sandbox, store, epoch } = createFixture("target-branch");
    write(sandbox.workspaceDir, "writer.txt", "writer\n");
    const writerHead = commit(sandbox.workspaceDir, "writer change");
    const canonicalHead = git(projectDir, "rev-parse", "HEAD");
    git(projectDir, "switch", "-c", "owner-work");
    const queue = new IntegrationQueue(projectDir, store);
    let validationCalled = false;

    const result = await queue.integrate({
      repositoryId: "primary",
      sandbox,
      epoch,
      signal: new AbortController().signal,
      validate: async () => {
        validationCalled = true;
        return { status: "passed", evidence: [] };
      },
    });

    expect(result).toEqual({
      status: "validation-failed",
      phase: "precondition",
      reason: "canonical-target-mismatch",
      repositoryId: "primary",
      runId: sandbox.runId,
      workspaceDir: sandbox.workspaceDir,
      branch: sandbox.branch,
      targetBranch: "main",
      writerHead,
      canonicalHead,
      observedCanonicalBranch: "owner-work",
    });
    expect(validationCalled).toBe(false);
    expect(git(projectDir, "branch", "--show-current")).toBe("owner-work");
    expect(git(projectDir, "rev-parse", "main")).toBe(canonicalHead);
  });
});
