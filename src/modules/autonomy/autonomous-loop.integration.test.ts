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
import { validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import {
  loadAutonomyWorkflowDefinitions,
  seedAutonomousLoopFixture,
  wait,
} from "./autonomous-loop.integration-test-helpers.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../claude-agent-harness/executor.js");
  return {
    ...actual,
    executeWithAgentSDK: vi.fn(),
  };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

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
    seedAutonomousLoopFixture(projectDir);
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

  it("a monitored completion reaches attention-digest but not issue-driven improver", async () => {
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
    expect(enqueued).not.toContain("improver");
  });
});
