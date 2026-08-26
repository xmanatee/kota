import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(25);
  }
}

export async function waitForCompletedWorkflows(
  completedRuns: Array<{ workflow: string }>,
  workflowNames: readonly string[],
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const seen = new Set(completedRuns.map((run) => run.workflow));
    if (workflowNames.every((name) => seen.has(name))) return;
    if (Date.now() >= deadline) break;
    await wait(25);
  }
  throw new Error(
    `Timed out waiting for workflows ${workflowNames.join(", ")}; saw ${
      completedRuns.map((run) => run.workflow).join(", ") || "none"
    }`,
  );
}

export async function loadAutonomyWorkflowDefinitions(): Promise<
  RegisteredWorkflowDefinitionInput[]
> {
  vi.resetModules();
  const [{ registerAgentHarness }, { claudeAgentHarness }] = await Promise.all([
    import("#core/agent-harness/registry.js"),
    import("#modules/claude-agent-harness/adapter.js"),
  ]);
  registerAgentHarness(claudeAgentHarness);
  const { default: autonomyModule } = await import("./index.js");
  const workflows = autonomyModule.workflows;
  if (!workflows || typeof workflows !== "function") {
    throw new Error(
      "autonomy module must expose workflows as a contribution factory",
    );
  }
  return [...await workflows({} as never)] as RegisteredWorkflowDefinitionInput[];
}

/**
 * Seed enough normalized queue state to exercise real autonomy handoffs while
 * keeping explorer on cooldown and all package validation scripts local.
 */
export function seedAutonomousLoopFixture(workspaceRoot: string): void {
  for (const dir of [
    "src/modules/autonomy/workflows/inbox-sorter",
    "src/modules/autonomy/workflows/explorer",
    "src/modules/autonomy/workflows/builder",
    "src/modules/autonomy/workflows/improver",
    "data/inbox",
    "data/tasks/ready",
    "data/tasks/backlog",
    "data/tasks/doing",
    "data/tasks/blocked",
    "data/tasks/done",
    "data/tasks/dropped",
    ".kota",
  ]) {
    mkdirSync(join(workspaceRoot, dir), { recursive: true });
  }

  writeFileSync(
    join(workspaceRoot, "src/modules/autonomy/workflows/inbox-sorter/prompt.md"),
    "Sort inbox.\n",
  );
  writeFileSync(
    join(workspaceRoot, "src/modules/autonomy/workflows/explorer/prompt.md"),
    "Explore.\n",
  );
  writeFileSync(
    join(workspaceRoot, "src/modules/autonomy/workflows/builder/prompt.md"),
    "Build.\n",
  );
  writeFileSync(
    join(workspaceRoot, "src/modules/autonomy/workflows/improver/prompt.md"),
    "Improve.\n",
  );
  writeFileSync(
    join(workspaceRoot, "data/inbox/task-capture.md"),
    "# Capture\n\nInteresting idea.\n",
  );

  const makeTask = (id: string, title: string, status: "ready" | "backlog") =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\npriority: ${status === "ready" ? "p2" : "p3"}\narea: workflow\nsummary: Summary.\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n\n## Problem\n\nA problem exists.\n\n## Desired Outcome\n\nThe problem is resolved.\n\n## Constraints\n\nNone.\n\n## Done When\n\nThe problem is gone.\n`;
  for (const [id, title] of [
    ["task-alpha", "Task Alpha"],
    ["task-beta", "Task Beta"],
    ["task-gamma", "Task Gamma"],
    ["task-delta", "Task Delta"],
  ]) {
    writeFileSync(
      join(workspaceRoot, `data/tasks/ready/${id}.md`),
      makeTask(id, title, "ready"),
    );
  }
  for (let i = 1; i <= 8; i++) {
    writeFileSync(
      join(workspaceRoot, `data/tasks/backlog/task-${i}.md`),
      makeTask(`task-${i}`, `Backlog ${i}`, "backlog"),
    );
  }

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  writeFileSync(
    join(workspaceRoot, ".kota/workflow-state.json"),
    JSON.stringify({
      completedRuns: 1,
      pendingRuns: [],
      workflows: {
        explorer: {
          lastCompletion: {
            runId: "run-explorer-seed",
            startedAt: tenMinutesAgo,
            completedAt: tenMinutesAgo,
            status: "success",
          },
        },
      },
    }),
  );
  writeFileSync(
    join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "test-fixture",
      scripts: Object.fromEntries(
        ["validate-tasks", "lint", "test", "typecheck", "build"].map(
          (name) => [name, "node -e \"process.exit(0)\""],
        ),
      ),
    }),
  );
  writeFileSync(
    join(workspaceRoot, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .: {}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(workspaceRoot, ".gitignore"),
    ".kota/\n.worktrees/\nnode_modules/\n",
  );
  execSync("git init -b main && git add .", { cwd: workspaceRoot });
  execSync('git -c user.email="test@test" -c user.name="Test" commit -m "init"', {
    cwd: workspaceRoot,
  });
}

export function seedIssueDrivenLoopFixture(workspaceRoot: string): void {
  for (const dir of [
    "data/tasks/ready",
    "data/tasks/backlog",
    "data/tasks/doing",
    "data/tasks/blocked",
    "data/tasks/done",
    "data/tasks/dropped",
    ".kota",
  ]) {
    mkdirSync(join(workspaceRoot, dir), { recursive: true });
  }
  writeFileSync(
    join(workspaceRoot, "package.json"),
    JSON.stringify({
      name: "issue-driven-loop-fixture",
      scripts: {
        "validate-tasks": "node -e \"process.exit(0)\"",
      },
    }),
  );
  writeFileSync(
    join(workspaceRoot, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "",
      "settings:",
      "  autoInstallPeers: true",
      "  excludeLinksFromLockfile: false",
      "",
      "importers:",
      "",
      "  .: {}",
      "",
    ].join("\n"),
  );
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\nnode_modules/\n");
  execSync("git init -b main && git add .", { cwd: workspaceRoot });
  execSync('git -c user.email="test@test" -c user.name="Test" commit -m "init"', {
    cwd: workspaceRoot,
  });
}
