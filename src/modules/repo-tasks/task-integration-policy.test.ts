import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowPostReconcileInvariantInput } from "#core/workflow/types.js";
import { taskQueueValidationCommand, verifyTaskOwnershipAfterReconcile } from "./task-integration-policy.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-task-publication-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("validates a foreign scope without running its package scripts", () => {
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { "validate-tasks": "touch package-script-ran" } }));
  mkdirSync(join(root, "data/tasks"), { recursive: true });
  const run = () => spawnSync(taskQueueValidationCommand[0], taskQueueValidationCommand.slice(1), { cwd: root, encoding: "utf8" });
  expect(run()).toMatchObject({ status: 0 });
  writeFileSync(join(root, "data/tasks/task-broken.md"), "unfinished content");
  expect(run()).toMatchObject({ status: 1, stderr: expect.stringContaining("task") });
  expect(existsSync(join(root, "package-script-ran"))).toBe(false);
});

it.each(["edit", "delete", "archive"])("protects held tasks during %s publication in a nested scope", (change) => {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  const scope = join(root, "nested scope");
  mkdirSync(join(scope, "data/tasks/archive"), { recursive: true });
  const task = join(scope, "data/tasks/task-owned.md");
  writeFileSync(task, "---\nstatus: open\npriority: p2\n---\n# Owned task\n\nPreserve the requested outcome.\n");
  git("add", "."); git("commit", "-qm", "baseline");
  const canonicalHead = git("rev-parse", "HEAD");
  if (change === "edit") writeFileSync(task, "Changed contract\n");
  else if (change === "delete") rmSync(task);
  else renameSync(task, join(scope, "data/tasks/archive/task-owned.md"));
  git("add", "."); git("commit", "-qm", "candidate");
  const db = new RunStateDatabase(join(root, ".kota"));
  try {
    const scopeId = "test-scope";
    const now = new Date().toISOString();
    db.registerScope({ id: scopeId, rootPath: scope, createdAt: now });
    db.admitRun({ id: "builder-owner", scopeId, workflow: "builder", repository: "write", resources: ["task:task-owned"], admittedAt: now,
      trigger: { event: "manual", schemaRef: null, payload: {} } });
    const input: WorkflowPostReconcileInvariantInput = {
      workspaceRoot: scope, repoRoot: scope, stateDir: join(scope, ".kota"), runId: "reviewer", workflowName: "reviewer",
      trigger: { event: "manual", schemaRef: null, payload: {} }, baseHead: canonicalHead, canonicalHead, head: git("rev-parse", "HEAD"),
      signal: new AbortController().signal, readState: () => ({ value: null, revision: 0 }),
      runEvidence: { getRun: (id) => db.getRun(id), listRuns: () => db.listRuns(scopeId) },
    };
    expect(verifyTaskOwnershipAfterReconcile(input)).toMatchObject({ satisfied: false, reason: expect.stringContaining("builder-owner") });
    expect(verifyTaskOwnershipAfterReconcile({ ...input, runId: "builder-owner" })).toEqual({ satisfied: true });
    expect(verifyTaskOwnershipAfterReconcile({ ...input, runEvidence: undefined })).toMatchObject({ satisfied: false });
    expect(verifyTaskOwnershipAfterReconcile({ ...input, head: canonicalHead, runEvidence: undefined })).toEqual({ satisfied: true });
    const { epoch } = db.beginDaemonSession(now);
    expect(db.startRun("builder-owner", epoch, now)).not.toBeNull();
    db.admitRun({ id: "queued-follower", scopeId, workflow: "repo-task-mutation", repository: "write",
      resources: ["task:task-owned"], admittedAt: now, trigger: input.trigger });
    expect(db.startRun("queued-follower", epoch, now)).toBeNull();
    db.beginIntegration("builder-owner", epoch, {});
    expect(verifyTaskOwnershipAfterReconcile({ ...input, runId: "builder-owner" })).toEqual({ satisfied: true });
    expect(verifyTaskOwnershipAfterReconcile(input)).toMatchObject({ satisfied: false });
  } finally { db.close(); }
});
