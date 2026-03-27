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
import { executeWithAgentSDK } from "../agent-sdk/index.js";
import { EventBus } from "../event-bus.js";
import { getBuiltinWorkflowDefinitions } from "../workflow/registry.js";
import { WorkflowRuntime } from "../workflow/runtime.js";

vi.mock("../agent-sdk/index.js", async () => {
  const actual = await vi.importActual("../agent-sdk/index.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Seed the fixture project so explorer's `needsAttention` evaluates to false,
 * causing the explore agent step to be skipped. This lets explorer complete
 * successfully without any real LLM call, triggering builder.
 *
 * Requirements for needsAttention = false:
 *   - inbox == 0 (no inbox task files)
 *   - ready >= READY_TASK_TARGET (2)
 *   - backlog >= BACKLOG_TASK_TARGET (4)
 *   - strategicRefreshDue = false (lastCompletedAt is recent)
 */
function seedFixtureProject(projectDir: string): void {
  for (const dir of [
    "src/workflows/explorer",
    "src/workflows/builder",
    "src/workflows/improver",
    "tasks/ready",
    "tasks/backlog",
    "tasks/inbox",
    "tasks/doing",
    "tasks/blocked",
    "tasks/done",
    "tasks/dropped",
    ".kota",
  ]) {
    mkdirSync(join(projectDir, dir), { recursive: true });
  }

  // Prompt files required by validateAgentStep
  writeFileSync(join(projectDir, "src/workflows/explorer/prompt.md"), "Explore.\n");
  writeFileSync(join(projectDir, "src/workflows/builder/prompt.md"), "Build.\n");
  writeFileSync(join(projectDir, "src/workflows/improver/prompt.md"), "Improve.\n");

  // 2 ready tasks — well-formed so they pass builder preflight validation
  const makeReadyTask = (id: string, title: string) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: ready\npriority: p2\narea: workflow\nsummary: Summary.\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\n---\n\n## Problem\n\nA problem exists.\n\n## Desired Outcome\n\nThe problem is resolved.\n\n## Constraints\n\nNone.\n\n## Done When\n\nThe problem is gone.\n`;
  writeFileSync(
    join(projectDir, "tasks/ready/task-alpha.md"),
    makeReadyTask("task-alpha", "Task Alpha"),
  );
  writeFileSync(
    join(projectDir, "tasks/ready/task-beta.md"),
    makeReadyTask("task-beta", "Task Beta"),
  );

  // 4 backlog tasks so BACKLOG_TASK_TARGET (4) is met
  for (let i = 1; i <= 4; i++) {
    writeFileSync(join(projectDir, `tasks/backlog/task-${i}.md`), `# Backlog ${i}\n`);
  }

  // Pre-seed runtime state with explorer's lastCompletedAt set to 1 hour ago:
  //   - Past the 30s cooldown window → explorer runs immediately on idle
  //   - Within the 2-hour strategic refresh window → strategicRefreshDue = false
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, ".kota/workflow-state.json"),
    JSON.stringify({
      completedRuns: 1,
      pendingRuns: [],
      workflows: {
        explorer: { lastCompletedAt: oneHourAgo },
      },
    }),
  );

  // Trivial package.json so preflight-lint and preflight-test pass instantly when
  // the workflow runs shell commands with cwd: projectDir (exit 0 for all scripts).
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify({ name: "test-fixture", scripts: { lint: "exit 0", test: "exit 0", typecheck: "exit 0", build: "exit 0" } }),
  );

  // Initialize a git repo so that claimTask can use `git mv` to stage task moves atomically.
  execSync("git init && git add tasks/ready/", { cwd: projectDir });
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
    "drives the explorer → builder → improver handoff using real workflow definitions",
    { timeout: 25_000 },
    async () => {
      // Agent steps in builder and improver fail (isError: true) so that
      // verification shell steps (npm run typecheck etc.) are skipped.
      // Builder and improver both complete with "failed" status.
      // Improver triggers on builder failure since its filter includes "failed".
      mockedExecuteWithAgentSDK.mockResolvedValue({
        text: "Agent step hit max turns",
        streamedText: "",
        turns: 40,
        totalCostUsd: 0.3,
        subtype: "error_max_turns",
        isError: true,
      });

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
        // Use the real builtin workflow definitions — this validates actual
        // trigger wiring and step configuration for all three workflows.
        workflows: getBuiltinWorkflowDefinitions(),
      });

      runtime.start();

      // Wait for all three workflows to complete:
      //   - Explorer: ~50ms (agent step skipped, all steps succeed or skip)
      //   - Builder:  ~5015ms (build step fails on 2nd attempt after 5s retry)
      //   - Improver: ~5015ms (improve step fails on 2nd attempt after 5s retry)
      // Total: ~10.1s; 14s gives comfortable buffer.
      await wait(14_000);

      await runtime.stop();

      // ── Explorer ──────────────────────────────────────────────────────────
      const explorerRun = completedRuns.find((r) => r.workflow === "explorer");
      expect(explorerRun, "explorer must complete").toBeDefined();
      expect(explorerRun?.status).toBe("success");

      // ── Builder triggered by explorer ─────────────────────────────────────
      const builderRun = completedRuns.find((r) => r.workflow === "builder");
      expect(builderRun, "builder must complete after explorer").toBeDefined();
      expect(builderRun?.triggerEvent).toBe("workflow.completed");

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
        counts: { ready: 2, backlog: 4, inbox: 0 },
      });

      // build agent step must have run and failed
      const buildStep = JSON.parse(
        readFileSync(join(runsDir, builderRunDir!, "steps", "build.json"), "utf-8"),
      );
      expect(buildStep.status).toBe("failed");
      expect(buildStep.error).toContain("error_max_turns");

      // verify steps must not have run (workflow exits on build failure before reaching them)
      expect(
        existsSync(join(runsDir, builderRunDir!, "steps", "verify-typecheck.json")),
      ).toBe(false);

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
    "writes explorer run artifacts and skips agent step when queue needs no attention",
    { timeout: 10_000 },
    async () => {
      // Explorer agent step must not be called (needsAttention = false)
      const bus = new EventBus();
      const runtime = new WorkflowRuntime({
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows: getBuiltinWorkflowDefinitions(),
      });

      runtime.start();
      // Explorer should complete very quickly — no agent calls for explorer itself
      await wait(200);
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
      expect(inspectStep.output.counts.ready).toBe(2);

      // explore agent step was skipped (file exists but status is "skipped")
      const exploreStep = JSON.parse(
        readFileSync(join(runsDir, explorerRunDir!, "steps", "explore.json"), "utf-8"),
      );
      expect(exploreStep.status).toBe("skipped");
    },
  );
});
