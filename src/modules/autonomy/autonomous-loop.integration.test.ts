import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWithAgentSDK } from "../../agent-sdk/index.js";
import { EventBus } from "../../event-bus.js";
import { WorkflowRuntime } from "../../workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "../../workflow/types.js";
import autonomyModule from "./index.js";

vi.mock("../../agent-sdk/index.js", async () => {
  const actual = await vi.importActual("../../agent-sdk/index.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAutonomyWorkflowDefinitions(): Promise<RegisteredWorkflowDefinitionInput[]> {
  const workflows = autonomyModule.workflows;
  if (!workflows || typeof workflows !== "function") {
    throw new Error("autonomy module must expose workflows as a contribution factory");
  }
  return [...await workflows({} as never)] as RegisteredWorkflowDefinitionInput[];
}

/**
 * Seed the fixture project so:
 *   - `inbox-sorter` has inbox work and can complete successfully without
 *     needing to mutate the fixture
 *   - `explorer` sees a non-empty normalized queue and therefore skips
 *   - `builder` still has actionable normalized work after inbox-sorter
 *     succeeds
 *
 * This lets us test the autonomous handoff cleanly without relying on
 * explorer to invent new tasks first.
 */
function seedFixtureProject(projectDir: string): void {
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
    mkdirSync(join(projectDir, dir), { recursive: true });
  }

  // Prompt files required by validateAgentStep
  writeFileSync(join(projectDir, "src/modules/autonomy/workflows/inbox-sorter/prompt.md"), "Sort inbox.\n");
  writeFileSync(join(projectDir, "src/modules/autonomy/workflows/explorer/prompt.md"), "Explore.\n");
  writeFileSync(join(projectDir, "src/modules/autonomy/workflows/builder/prompt.md"), "Build.\n");
  writeFileSync(join(projectDir, "src/modules/autonomy/workflows/improver/prompt.md"), "Improve.\n");

  // One inbox capture so inbox-sorter has work.
  writeFileSync(join(projectDir, "data/inbox/task-capture.md"), "# Capture\n\nInteresting idea.\n");

  // 4 ready tasks — well-formed so they pass builder preflight validation
  const makeReadyTask = (id: string, title: string) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ready\npriority: p2\narea: workflow\nsummary: Summary.\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n\n## Problem\n\nA problem exists.\n\n## Desired Outcome\n\nThe problem is resolved.\n\n## Constraints\n\nNone.\n\n## Done When\n\nThe problem is gone.\n`;
  const makeBacklogTask = (id: string, title: string) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: backlog\npriority: p3\narea: workflow\nsummary: Summary.\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n\n## Problem\n\nA problem exists.\n\n## Desired Outcome\n\nThe problem is resolved.\n\n## Constraints\n\nNone.\n\n## Done When\n\nThe problem is gone.\n`;
  writeFileSync(
    join(projectDir, "data/tasks/ready/task-alpha.md"),
    makeReadyTask("task-alpha", "Task Alpha"),
  );
  writeFileSync(
    join(projectDir, "data/tasks/ready/task-beta.md"),
    makeReadyTask("task-beta", "Task Beta"),
  );
  writeFileSync(
    join(projectDir, "data/tasks/ready/task-gamma.md"),
    makeReadyTask("task-gamma", "Task Gamma"),
  );
  writeFileSync(
    join(projectDir, "data/tasks/ready/task-delta.md"),
    makeReadyTask("task-delta", "Task Delta"),
  );

  // 8 backlog tasks so BACKLOG_TASK_TARGET (8) is met
  for (let i = 1; i <= 8; i++) {
    writeFileSync(
      join(projectDir, `data/tasks/backlog/task-${i}.md`),
      makeBacklogTask(`task-${i}`, `Backlog ${i}`),
    );
  }

  // Pre-seed runtime state with explorer's lastCompletedAt set to 10 minutes ago
  // so explorer will skip broad research while local normalized work exists.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, ".kota/workflow-state.json"),
    JSON.stringify({
      completedRuns: 1,
      pendingRuns: [],
      workflows: {
        explorer: { lastCompletedAt: tenMinutesAgo },
      },
    }),
  );

  // Trivial package.json so end-of-step validation checks pass instantly when
  // the workflow runs shell commands with cwd: projectDir (exit 0 for all scripts).
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "test-fixture",
      scripts: {
        "validate-tasks": "node -e \"process.exit(0)\"",
        lint: "node -e \"process.exit(0)\"",
        test: "node -e \"process.exit(0)\"",
        typecheck: "node -e \"process.exit(0)\"",
        build: "node -e \"process.exit(0)\"",
      },
    }),
  );

  // .gitignore mirrors the real project: .kota/ is runtime state, not source.
  // Without this, assertRepoWorktreeClean would fail when the workflow runtime
  // modifies workflow-state.json and creates run artifacts before the step runs.
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");

  // Initialize a git repo so workflow commit steps can run if a test needs them.
  // Commit all seeded files (excluding .kota/) so assertRepoWorktreeClean passes.
  execSync("git init && git add .", { cwd: projectDir });
  execSync('git -c user.email="test@test" -c user.name="Test" commit -m "init"', {
    cwd: projectDir,
  });
}

describe("autonomous workflow loop integration", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    seedFixtureProject(projectDir);
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    "drives the inbox-sorter → builder → improver handoff using real workflow definitions",
    { timeout: 25_000 },
    async () => {
      mockedExecuteWithAgentSDK
        .mockResolvedValueOnce({
          text: "Inbox sorted",
          streamedText: "",
          turns: 1,
          totalCostUsd: 0.01,
          isError: false,
        } as never)
        .mockResolvedValue({
          text: "Agent step hit max turns",
          streamedText: "",
          turns: 40,
          totalCostUsd: 0.3,
          subtype: "error_max_turns",
          isError: true,
        } as never);

      const bus = new EventBus();
      const completedRuns: Array<{
        workflow: string;
        status: string;
        triggerEvent: string;
        triggerPayload: Record<string, unknown>;
      }> = [];

      bus.on("workflow.completed", (payload) => {
        completedRuns.push({
          workflow: payload.workflow as string,
          status: payload.status as string,
          triggerEvent: payload.triggerEvent as string,
          triggerPayload: payload as Record<string, unknown>,
        });
      });

      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows: (await loadAutonomyWorkflowDefinitions()).filter((workflow) =>
          ["dispatcher", "inbox-sorter", "builder", "improver"].includes(workflow.name),
        ),
      });

      runtime.start();

      // Wait for all three workflows to complete:
      //   - inbox-sorter: ~50ms
      //   - builder: ~5s (2 attempts with one 5s retry delay)
      //   - improver: ~5s (2 attempts with one 5s retry delay)
      // Keep extra slack because the runtime, filesystem, and test host all
      // add jitter around event dispatch and artifact writes.
      await wait(20_000);

      await runtime.stop();

      // ── Inbox sorter ──────────────────────────────────────────────────────
      const inboxSorterRun = completedRuns.find((r) => r.workflow === "inbox-sorter");
      expect(inboxSorterRun, "inbox-sorter must complete").toBeDefined();
      expect(inboxSorterRun?.status).toBe("success");

      // ── Builder triggered by inbox-sorter ─────────────────────────────────
      const builderRun = completedRuns.find((r) => r.workflow === "builder");
      expect(builderRun, "builder must complete after inbox-sorter").toBeDefined();
      expect(builderRun?.triggerEvent).toBe("autonomy.queue.available");

      // ── Builder run artifacts ─────────────────────────────────────────────
      const runsDir = join(projectDir, ".kota", "runs");
      expect(existsSync(runsDir)).toBe(true);
      const runIds = readdirSync(runsDir);
      expect(runIds.length).toBeGreaterThanOrEqual(2);

      const builderRunDir = runIds.find((id) => {
        const meta = JSON.parse(readFileSync(join(runsDir, id, "metadata.json"), "utf-8"));
        return meta.workflow === "builder";
      });
      expect(builderRunDir, "builder run directory must exist").toBeDefined();

      const builderMeta = JSON.parse(
        readFileSync(join(runsDir, builderRunDir!, "metadata.json"), "utf-8"),
      );
      expect(builderMeta.status).toBe("failed");

      // inspect-ready-queue step must have run and returned the task snapshot
      const inspectStep = JSON.parse(
        readFileSync(join(runsDir, builderRunDir!, "steps", "inspect-ready-queue.json"), "utf-8"),
      );
      expect(inspectStep.status).toBe("success");
      expect(inspectStep.output).toMatchObject({
        counts: { ready: 4, backlog: 8 },
        inboxCount: 1,
      });

      // build agent step must have run and failed
      const buildStep = JSON.parse(
        readFileSync(join(runsDir, builderRunDir!, "steps", "build.json"), "utf-8"),
      );
      expect(buildStep.status).toBe("failed");
      expect(buildStep.error).toContain("error_max_turns");

      // post-build commit should not have run on a failed build step
      expect(existsSync(join(runsDir, builderRunDir!, "steps", "commit.json"))).toBe(false);

      // ── Improver triggered by builder failure ─────────────────────────────
      const improverRun = completedRuns.find((r) => r.workflow === "improver");
      expect(improverRun, "improver must be triggered by builder completion").toBeDefined();
      expect(improverRun?.triggerEvent).toBe("workflow.completed");

      const improverRunDir = runIds.find((id) => {
        const meta = JSON.parse(readFileSync(join(runsDir, id, "metadata.json"), "utf-8"));
        return meta.workflow === "improver";
      });
      expect(improverRunDir, "improver run directory must exist").toBeDefined();

      const improverMeta = JSON.parse(
        readFileSync(join(runsDir, improverRunDir!, "metadata.json"), "utf-8"),
      );

      // Verify the trigger payload improver received from builder
      expect(improverMeta.trigger.event).toBe("workflow.completed");
      expect(improverMeta.trigger.payload).toMatchObject({
        workflow: "builder",
        status: "failed",
      });
    },
  );

  it(
    "explorer skips agent step when exploration refresh is not due",
    { timeout: 10_000 },
    async () => {
      // Clear ready tasks and inbox so the dispatcher emits autonomy.queue.empty,
      // which triggers the explorer. The explorer then skips the agent step because
      // lastCompletedAt was 10 minutes ago (within the 30-minute refresh window).
      for (const f of readdirSync(join(projectDir, "data/tasks/ready"))) {
        rmSync(join(projectDir, "data/tasks/ready", f));
      }
      for (const f of readdirSync(join(projectDir, "data/tasks/backlog"))) {
        rmSync(join(projectDir, "data/tasks/backlog", f));
      }
      for (const f of readdirSync(join(projectDir, "data/inbox"))) {
        rmSync(join(projectDir, "data/inbox", f));
      }
      execSync("git add -A && git -c user.email='t@t' -c user.name='T' commit -m 'clear'", {
        cwd: projectDir,
      });

      const bus = new EventBus();
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows: (await loadAutonomyWorkflowDefinitions()).filter((w) =>
          ["dispatcher", "explorer"].includes(w.name),
        ),
      });

      runtime.start();
      await wait(500);
      await runtime.stop();

      const runsDir = join(projectDir, ".kota", "runs");
      const runIds = readdirSync(runsDir);
      const explorerRunDir = runIds.find((id) => {
        const meta = JSON.parse(readFileSync(join(runsDir, id, "metadata.json"), "utf-8"));
        return meta.workflow === "explorer";
      });
      expect(explorerRunDir, "explorer run directory must exist").toBeDefined();

      const explorerMeta = JSON.parse(
        readFileSync(join(runsDir, explorerRunDir!, "metadata.json"), "utf-8"),
      );
      expect(explorerMeta.status).toBe("success");
      expect(explorerMeta.workflow).toBe("explorer");

      // inspect-queue step ran and returned the assessment
      const inspectStep = JSON.parse(
        readFileSync(join(runsDir, explorerRunDir!, "steps", "inspect-queue.json"), "utf-8"),
      );
      expect(inspectStep.status).toBe("success");
      expect(inspectStep.output.needsAttention).toBe(false);
      expect(inspectStep.output.explorationRefreshDue).toBe(false);

      // explore agent step was skipped
      const exploreStep = JSON.parse(
        readFileSync(join(runsDir, explorerRunDir!, "steps", "explore.json"), "utf-8"),
      );
      expect(exploreStep.status).toBe("skipped");
    },
  );
});
