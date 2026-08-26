import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import repoTaskMutationWorkflow from "./repo-task-mutation-workflow.js";

describe("repo-task mutation workflow", () => {
  const roots: string[] = [];

  afterEach(() => {
    resetProviderRegistry();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("integrates through the shared writer lifecycle and returns a stable repository path", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-repo-task-workflow-"));
    roots.push(root);
    const workspaceRoot = join(root, "project");
    const taskPath = join(workspaceRoot, "data", "tasks", "ready", "task-new-task.md");
    mkdirSync(join(workspaceRoot, "data", "tasks", "ready"), { recursive: true });
    writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
    execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: workspaceRoot });
    execFileSync("git", ["config", "user.name", "KOTA Test"], { cwd: workspaceRoot });
    execFileSync("git", ["config", "user.email", "kota@example.test"], { cwd: workspaceRoot });
    execFileSync("git", ["add", "--all"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "--message", "baseline"], { cwd: workspaceRoot });
    initProviderRegistry();

    const host = new StandaloneRunHost({
      stateDir: join(root, "state"),
      scope: { scopeId: "repo-task-scope", scopeRoot: workspaceRoot, displayName: "Repo tasks" },
      bus: new EventBus(),
      workflows: [{
        ...repoTaskMutationWorkflow,
        enabled: true,
        moduleRoot: workspaceRoot,
        definitionPath: "repo-task-mutation-workflow-test",
        integration: { validationCommand: ["true"] },
      }],
    });

    try {
      const result = await host.runToTerminal("repo-task-mutation", {
        runId: "repo-task-mutation-test",
        event: "repo-task.mutation.requested",
        payload: {
          request: {
            kind: "create",
            options: {
              title: "New task",
              priority: "p1",
              area: "runtime",
              state: "ready",
            },
          },
        },
      });
      expect(result.run.state).toBe("succeeded");
      expect(readFileSync(taskPath, "utf8")).toContain("title: New task");
      expect(result.metadata?.steps.at(-1)?.output).toEqual({
        ok: true,
        id: "task-new-task",
        path: "data/tasks/ready/task-new-task.md",
      });
      expect(result.run.integration).toMatchObject({ phase: "merged" });
    } finally {
      await host.close();
    }
  });
});
