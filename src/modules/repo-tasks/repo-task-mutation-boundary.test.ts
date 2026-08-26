import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDirectoryScope } from "#core/daemon/scope-registry.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import {
  WORKFLOW_DISPATCHER_PROVIDER_TYPE,
  type WorkflowDispatcher,
} from "#core/workflow/workflow-dispatcher-provider.js";
import {
  decodeRepoTaskMutationRequest,
  mutateRepoTask,
  repoTaskMutationResources,
} from "./repo-task-mutation-boundary.js";
import {
  createRepoTaskRuntimeSandbox,
  disposeRepoTaskRuntimeSandboxes,
  finishRepoTaskRuntimeSandbox,
} from "./repo-task-mutation-test-support.js";

const roots: string[] = [];

afterEach(() => {
  disposeRepoTaskRuntimeSandboxes();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  resetProviderRegistry();
});

function projectWithTask() {
  const workspaceRoot = join(tmpdir(), `kota-task-mutation-${Date.now()}-${Math.random()}`);
  roots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data", "tasks", "ready"), { recursive: true });
  const taskPath = join(workspaceRoot, "data", "tasks", "ready", "task-example.md");
  writeFileSync(
    taskPath,
    "---\nid: task-example\ntitle: Example\nstatus: ready\n---\n\n## Problem\n\nOld.\n",
  );
  return {
    workspaceRoot,
    taskPath,
    scopeId: buildDirectoryScope({ scopeRoot: workspaceRoot }).scopeId,
  };
}

function registerDispatcher(execute: WorkflowDispatcher["execute"]): void {
  initProviderRegistry().register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "test", {
    enqueuePendingRun: () => ({ ok: false }),
    enqueueWebhookRun: () => ({ ok: false }),
    execute,
  });
}

describe("repo-task mutation", () => {
  it("fails closed when canonical mutation has no active workflow runtime", async () => {
    const value = projectWithTask();
    await expect(mutateRepoTask({ authority: "canonical", scopeId: value.scopeId }, {
      kind: "update-body",
      id: "task-example",
      body: "## Problem\n\nUpdated.",
    })).rejects.toThrow(/active workflow runtime/i);
    expect(readFileSync(value.taskPath, "utf8")).toContain("Old.");
  });

  it("dispatches canonical mutations through the ordinary writer workflow", async () => {
    const value = projectWithTask();
    const execute = vi.fn<WorkflowDispatcher["execute"]>().mockResolvedValue({
      ok: true,
      runId: "run-repo-task-mutation",
      output: { ok: true, id: "task-example", state: "ready" },
    });
    registerDispatcher(execute);

    await expect(mutateRepoTask({ authority: "canonical", scopeId: value.scopeId }, {
      kind: "update-body",
      id: "task-example",
      body: "## Problem\n\nUpdated.",
    })).resolves.toMatchObject({ ok: true, id: "task-example" });
    expect(execute).toHaveBeenCalledWith({
      workflow: "repo-task-mutation",
      scopeId: value.scopeId,
      event: "repo-task.mutation.requested",
      payload: {
        request: {
          kind: "update-body",
          id: "task-example",
          body: "## Problem\n\nUpdated.",
        },
      },
    });
    expect(readFileSync(value.taskPath, "utf8")).toContain("Old.");
  });

  it("accepts only opaque writer authority issued by the runtime", async () => {
    const scopeDir = join(tmpdir(), `kota-task-writer-${Date.now()}-${Math.random()}`);
    roots.push(scopeDir);
    const target = createRepoTaskRuntimeSandbox(scopeDir, "repo-task-writer-test");
    await expect(mutateRepoTask(target, {
      kind: "move",
      id: "task-missing",
      state: "doing",
    })).resolves.toEqual({ ok: false, reason: "not_found" });

    await expect(mutateRepoTask(
      { authority: "runtime-owned-sandbox", repositoryAccess: {} as never },
      { kind: "move", id: "task-missing", state: "doing" },
    )).rejects.toThrow(/runtime-owned writer repository/i);
  });

  it("revokes writer authority when its run attempt finishes", async () => {
    const scopeDir = join(tmpdir(), `kota-task-revoked-${Date.now()}-${Math.random()}`);
    roots.push(scopeDir);
    const target = createRepoTaskRuntimeSandbox(scopeDir, "repo-task-revoked-test");
    finishRepoTaskRuntimeSandbox(target.workspaceRoot);

    await expect(mutateRepoTask(target, {
      kind: "move",
      id: "task-missing",
      state: "doing",
    })).rejects.toThrow(/not active/i);
  });

  it("uses one logical resource identity for capture and retraction", () => {
    const workspaceRoot = join(tmpdir(), `kota-inbox-resource-${Date.now()}`);
    roots.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
    expect(repoTaskMutationResources(workspaceRoot, {
      kind: "capture-inbox",
      id: "note-owned",
      content: "owned\n",
    })).toEqual(["inbox:note-owned"]);
    expect(repoTaskMutationResources(workspaceRoot, {
      kind: "retract-inbox",
      path: "data/inbox/note-owned.md",
    })).toEqual(["inbox:note-owned"]);
  });

  it("rejects invalid untyped workflow payloads before resource admission", () => {
    expect(() => decodeRepoTaskMutationRequest({
      kind: "create",
      options: { title: "Bad", priority: "p9", area: "core", state: "ready" },
    })).toThrow(/valid priority/);
    expect(() => decodeRepoTaskMutationRequest({
      kind: "gc",
      options: { days: 0 },
    })).toThrow(/positive number/);
  });

  it("does not overwrite a colliding quick-create inbox id", async () => {
    const scopeDir = join(tmpdir(), `kota-task-collision-${Date.now()}`);
    roots.push(scopeDir);
    const target = createRepoTaskRuntimeSandbox(scopeDir, "repo-task-collision-test");
    mkdirSync(join(target.workspaceRoot, "data", "inbox"), { recursive: true });
    const path = join(target.workspaceRoot, "data", "inbox", "task-example.md");
    writeFileSync(path, "original\n");

    await expect(mutateRepoTask(target, {
      kind: "quick-create",
      id: "task-example",
      title: "Replacement",
      summary: "must not win",
    })).resolves.toEqual({ ok: false, reason: "already_exists" });
    expect(readFileSync(path, "utf8")).toBe("original\n");
  });
});
