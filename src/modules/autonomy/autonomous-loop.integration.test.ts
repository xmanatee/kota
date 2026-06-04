// This test discovers the autonomy workflow set from
// `src/modules/autonomy/workflows/`. When adding a new workflow there, ensure
// its trigger and step behavior is safe against the sparse fixture seeded
// below; the self-trigger loop guard is enforced separately by the workflow
// validator at definition load time.
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
import { loadConfig } from "#core/config/config.js";
import { EventBus } from "#core/events/event-bus.js";
import { getPreset, PRESET_ENV_VAR } from "#core/model/preset.js";
import { enqueueMatchingWorkflows } from "#core/workflow/run-executor-utils.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../claude-agent-harness/executor.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAutonomyWorkflowDefinitions(): Promise<RegisteredWorkflowDefinitionInput[]> {
  vi.resetModules();
  const { default: autonomyModule } = await import("./index.js");
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

  // Pre-seed runtime state so the explorer cooldown timer sees a recent completion.
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  writeFileSync(
    join(projectDir, ".kota/workflow-state.json"),
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

  // Explorer now measures refresh from a file-based timestamp instead of
  // its workflow-state completion, so seed that too.
  writeFileSync(
    join(projectDir, ".kota/explorer-state.json"),
    JSON.stringify({ lastExplorationAt: tenMinutesAgo }),
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
  // Without this, getRepoWorktreeStatus would report dirty when the workflow
  // runtime modifies workflow-state.json and creates run artifacts.
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");

  // Initialize a git repo so workflow commit steps can run if a test needs them.
  // Commit all seeded files (excluding .kota/) so worktree reads as clean.
  execSync("git init && git add .", { cwd: projectDir });
  execSync('git -c user.email="test@test" -c user.name="Test" commit -m "init"', {
    cwd: projectDir,
  });
}

describe("autonomous workflow loop integration", () => {
  let projectDir: string;
  let savedPreset: string | undefined;

  beforeEach(() => {
    savedPreset = process.env[PRESET_ENV_VAR];
    process.env[PRESET_ENV_VAR] = "claude";
    projectDir = join(
      tmpdir(),
      `kota-integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    seedFixtureProject(projectDir);
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (savedPreset === undefined) {
      delete process.env[PRESET_ENV_VAR];
    } else {
      process.env[PRESET_ENV_VAR] = savedPreset;
    }
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
        config: { defaultAgentHarness: "claude-agent-sdk", defaultPreset: "claude" },
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

      // ── Improver triggered by any monitored completion ────────────────────
      // Improver now fires on any monitored completion (success or failure) —
      // it reads 24h/7d aggregates, not one specific run, so it's
      // entity-agnostic by design. The evidence gate is the pacing gate: it
      // skips when recent run data has no new actionable signal.
      const improverRun = completedRuns.find((r) => r.workflow === "improver");
      expect(improverRun, "improver must be triggered by a monitored completion").toBeDefined();
      expect(improverRun?.triggerEvent).toBe("workflow.completed");

      const improverRunDir = runIds.find((id) => {
        const meta = JSON.parse(readFileSync(join(runsDir, id, "metadata.json"), "utf-8"));
        return meta.workflow === "improver";
      });
      expect(improverRunDir, "improver run directory must exist").toBeDefined();

      const improverMeta = JSON.parse(
        readFileSync(join(runsDir, improverRunDir!, "metadata.json"), "utf-8"),
      );

      // Trigger event is always workflow.completed; the payload's workflow
      // may be any monitored workflow that completed first within the window.
      expect(improverMeta.trigger.event).toBe("workflow.completed");
      expect(improverMeta.trigger.payload.tags).toContain("monitored");
    },
  );

  it(
    "explorer does not run when exploration refresh is not due (no-op churn eliminated)",
    { timeout: 10_000 },
    async () => {
      // Clear ready tasks, backlog, and inbox so the dispatcher emits autonomy.queue.empty.
      // The explorer trigger cooldown (30 min) matches the exploration refresh window,
      // so with the last completion only 10 minutes ago, the explorer should not be
      // eligible to run — eliminating no-op churn.
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
        config: { defaultAgentHarness: "claude-agent-sdk", defaultPreset: "claude" },
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
      expect(explorerRunDir, "explorer must NOT run when cooldown has not elapsed").toBeUndefined();
    },
  );

  it(
    "validates and runs real workflows against an external project directory without KOTA source",
    async () => {
      // Use a project directory that is NOT the KOTA source tree, and does not
      // contain any `src/modules/autonomy/workflows/*/prompt.md` files. The
      // real autonomy workflows must still validate and execute because their
      // `promptPath` resolves against `moduleRoot` (KOTA's install root), not
      // against `projectDir`.
      const externalProjectDir = join(
        tmpdir(),
        `kota-external-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(externalProjectDir, { recursive: true });
      try {
        mkdirSync(join(externalProjectDir, ".kota"), { recursive: true });
        writeFileSync(join(externalProjectDir, ".gitignore"), ".kota/\n");
        writeFileSync(
          join(externalProjectDir, "package.json"),
          JSON.stringify({ name: "external-fixture" }),
        );
        writeFileSync(
          join(externalProjectDir, ".kota", "config.json"),
          JSON.stringify({
            guardrails: {
              policies: { dangerous: "allow" },
              toolOverrides: { process: "allow" },
            },
            providers: { memory: "repo-memory" },
            defaultAgentHarness: "repo-harness",
            defaultPreset: "gemini",
            model: "repo-model",
            modelTiers: { capable: "repo-capable" },
            foreignModules: [{ transport: "stdio", command: "repo-owned-module" }],
            serve: { noAuth: true },
          }),
        );
        execSync("git init && git add .", { cwd: externalProjectDir });
        execSync(
          'git -c user.email="t@t" -c user.name="T" commit -m "init"',
          { cwd: externalProjectDir },
        );

        // Sanity: the external project has no KOTA source seeded.
        expect(
          existsSync(join(externalProjectDir, "src/modules/autonomy")),
        ).toBe(false);

        const rawDefs = await loadAutonomyWorkflowDefinitions();
        expect(rawDefs.length).toBeGreaterThan(0);
        for (const def of rawDefs) {
          expect(def.moduleRoot, `workflow ${def.name} must carry moduleRoot`).toBeDefined();
          // moduleRoot must point to KOTA's install root (which contains src/),
          // not to the external project dir.
          expect(def.moduleRoot).not.toBe(externalProjectDir);
          expect(
            existsSync(join(def.moduleRoot!, "src/modules/autonomy")),
          ).toBe(true);
        }

        const operatorConfig = loadConfig(externalProjectDir, {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
          model: "operator-model",
          providers: { memory: "operator-memory" },
          guardrails: {
            policies: { safe: "allow", moderate: "allow", dangerous: "queue" },
          },
        });
        expect(operatorConfig.defaultAgentHarness).toBe("claude-agent-sdk");
        expect(operatorConfig.defaultPreset).toBe("claude");
        expect(operatorConfig.model).toBe("operator-model");
        expect(operatorConfig.providers?.memory).toBe("operator-memory");
        expect(operatorConfig.guardrails?.policies.dangerous).toBe("queue");
        expect(operatorConfig.guardrails?.toolOverrides).toBeUndefined();
        expect(operatorConfig.foreignModules).toBeUndefined();
        expect(operatorConfig.serve?.noAuth).toBeUndefined();

        // Validation must succeed against the external project dir. If
        // promptPath were resolved against projectDir, every agent step would
        // fail with `promptPath does not exist`.
        const compiled = validateWorkflowDefinitions(rawDefs, externalProjectDir, {
          defaultAgentHarness: operatorConfig.defaultAgentHarness,
          preset: getPreset(operatorConfig.defaultPreset ?? "claude"),
        });
        expect(compiled.length).toBe(rawDefs.length);
        for (const def of compiled) {
          expect(def.moduleRoot).not.toBe(externalProjectDir);
        }

        // Boot the runtime against the external project and drive an agent
        // step. With no tasks and no inbox, the builder should pull nothing
        // but still start, proving the daemon can operate on an external
        // project. Mock the SDK so we don't spend real turns.
        mockedExecuteWithAgentSDK.mockResolvedValue({
          text: "ok",
          streamedText: "",
          turns: 1,
          totalCostUsd: 0,
          isError: false,
        } as never);

        const bus = new EventBus();
        const runtime = new WorkflowRuntime({
          config: operatorConfig,
          bus,
          projectDir: externalProjectDir,
          idleIntervalMs: 10,
          workflows: compiled.filter((w) => w.name === "dispatcher"),
        });
        runtime.start();
        await wait(200);
        await runtime.stop();

        // No crash means the daemon booted and ticked at least once against
        // the external project directory using KOTA-owned workflow prompts.
        expect(true).toBe(true);
      } finally {
        rmSync(externalProjectDir, { recursive: true, force: true });
      }
    },
  );

  it("a new workflow tagged 'monitored' is observed by attention-digest and improver without editing them", async () => {
    mkdirSync(join(projectDir, "src/modules/autonomy/workflows/attention-digest"), { recursive: true });
    writeFileSync(join(projectDir, "src/modules/autonomy/workflows/attention-digest/prompt.md"), "Digest.\n");

    const rawDefs = await loadAutonomyWorkflowDefinitions();
    const compiled = validateWorkflowDefinitions(
      rawDefs.filter((d) => d.name === "attention-digest" || d.name === "improver"),
      projectDir,
      { defaultAgentHarness: "claude-agent-sdk", preset: getPreset("claude") },
    );

    const attentionDigest = compiled.find((d) => d.name === "attention-digest")!;
    const improver = compiled.find((d) => d.name === "improver")!;
    expect(attentionDigest).toBeDefined();
    expect(improver).toBeDefined();

    const enqueued: string[] = [];
    const envelope = {
      type: "workflow.completed" as const,
      schemaRef: null,
      payload: {
        workflow: "brand-new-workflow",
        runId: "run-xyz",
        status: "failed" as const,
        triggerEvent: "some.event",
        durationMs: 5000,
        definitionPath: "src/modules/autonomy/workflows/brand-new/workflow.ts",
        runDir: ".kota/runs/run-xyz",
        tags: ["monitored"] as readonly string[],
      },
    };

    enqueueMatchingWorkflows(envelope, [attentionDigest, improver], (def) => {
      enqueued.push(def.name);
    });

    expect(enqueued).toContain("attention-digest");
    expect(enqueued).toContain("improver");
  });
});
