import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { initProviderRegistry, resetProviderRegistry } from "#core/modules/provider-registry.js";
import { StandaloneRunHost } from "#core/workflow/standalone-run-host.js";
import { CaptureProviderImpl } from "#modules/capture/capture-provider.js";
import type { CaptureScopeContext } from "#modules/capture/capture-types.js";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { RetractProviderImpl } from "#modules/retract/retract-provider.js";
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
    const taskPath = join(workspaceRoot, "data", "tasks", "task-new-task.md");
    mkdirSync(join(workspaceRoot, "data", "tasks"), { recursive: true });
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
              body: "Preserve the submitted outcome through writer integration.\n\nKeep this final line.  \n",
              priority: "p1",
              state: "open",
            },
          },
        },
      });
      expect(result.run.state).toBe("succeeded");
      expect(readFileSync(taskPath, "utf8")).toContain("# New task");
      expect(readFileSync(taskPath, "utf8")).toContain("Preserve the submitted outcome through writer integration.\n\nKeep this final line.  \n");
      expect(result.metadata?.steps.at(-1)?.output).toEqual({
        ok: true,
        id: "task-new-task",
        path: "data/tasks/task-new-task.md",
      });
      expect(result.run.integration).toMatchObject({ phase: "merged" });

      const scope: CaptureScopeContext = {
        scopeId: "repo-task-scope",
        scopeRoot: workspaceRoot,
        memory: new MemoryStore(join(workspaceRoot, ".kota")),
        knowledge: new KnowledgeStore(workspaceRoot, join(root, "global")),
        getWorkflowDispatcher: () => host.scopeRuntime.workflowRuntime,
      };
      const capture = new CaptureProviderImpl();
      const text = `  Preserve capture ${"detail ".repeat(24)}\n\n  Indented evidence\n\nLast line.  \n`;
      const captured = await capture.capture(text, { target: "tasks" }, scope);
      expect(captured, JSON.stringify(captured)).toMatchObject({ ok: true, target: "tasks" });
      if (!captured.ok || captured.target !== "tasks") throw new Error("Expected task capture");
      const capturedPath = join(workspaceRoot, captured.path);
      expect(readFileSync(capturedPath, "utf8")).toContain(text);
      expect(readFileSync(capturedPath, "utf8")).not.toContain("Describe the problem");

      const roughText = "  Rough capture\n\nKeep every line and trailing space.  ";
      const inbox = await capture.capture(roughText, undefined, scope);
      expect(inbox, JSON.stringify(inbox)).toMatchObject({ ok: true, target: "inbox" });
      if (!inbox.ok || inbox.target !== "inbox") throw new Error("Expected inbox capture");
      expect(readFileSync(join(workspaceRoot, inbox.path), "utf8")).toBe(roughText);
      expect(existsSync(join(workspaceRoot, "data/tasks/task-rough-capture.md"))).toBe(false);

      const retract = new RetractProviderImpl();
      await expect(retract.retract({ target: "tasks", identifier: captured.id }, scope))
        .resolves.toMatchObject({ ok: true, target: "tasks", toState: "dropped" });
      expect(existsSync(capturedPath)).toBe(false);
      expect(readFileSync(join(workspaceRoot, "data/tasks/archive", `${captured.id}.md`), "utf8"))
        .toContain(text);
      await expect(retract.retract({ target: "inbox", identifier: inbox.path }, scope))
        .resolves.toMatchObject({ ok: true, target: "inbox" });
      expect(existsSync(join(workspaceRoot, inbox.path))).toBe(false);
    } finally {
      await host.close();
    }
  });
});
