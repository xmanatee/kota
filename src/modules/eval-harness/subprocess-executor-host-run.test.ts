import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { REPLAY_AGENT_HARNESS_NAME_ENV } from "./replay-harness.js";
import { createSubprocessExecutor } from "./subprocess-executor.js";
import {
  cleanupSubprocessTestDirs,
  createSubprocessTestDirs,
  type SubprocessTestDirs,
  writeFakeKotaScript,
  writeTerminalRun,
} from "./subprocess-executor-test-helpers.js";

describe("createSubprocessExecutor host execution", () => {
  let dirs: SubprocessTestDirs;

  beforeEach(() => {
    dirs = createSubprocessTestDirs();
  });

  afterEach(() => {
    cleanupSubprocessTestDirs(dirs);
  });

  it("reports timeout when the child exceeds the fixture budget", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-sleep.mjs");
    writeFakeKotaScript(fakeKota, "setInterval(() => {}, 1000);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "sleepy",
      workingDir: dirs.workingDir,
      budgetMs: 200,
    });

    expect(outcome.kind).toBe("timeout");
    expect(outcome.runArtifactPath).toBeNull();
    expect(outcome.durationMs).toBeGreaterThanOrEqual(200);
  });

  it("reports error when the child exits cleanly without a run artifact", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-silent.mjs");
    writeFakeKotaScript(fakeKota, "process.exit(0);\n");

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "ghost",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/no terminal run artifact/);
    }
  });

  it("reports completed when the child exits 0 and a terminal run exists", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-success.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-abc');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-abc', workflow: 'noop', status: 'success',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      triggerEvent: "fixture.ready",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    expect(outcome.runArtifactPath).toContain("run-1-noop-abc");
  });

  it("passes requested agent harness, model, and effort overrides to workflow exec", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-agent-override.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'argv.json'), JSON.stringify(process.argv.slice(2)));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-agent-override');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-agent-override', workflow: 'noop', status: 'success',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
      triggerEvent: "fixture.ready",
      agentExecutionOverride: {
        harness: "openai-tools",
        model: "openrouter/z-ai/glm-5.2",
        effort: "max",
      },
    });

    expect(outcome.kind).toBe("completed");
    const argv = JSON.parse(
      readFileSync(join(dirs.workingDir, "argv.json"), "utf8"),
    ) as string[];
    expect(argv).toEqual([
      "workflow",
      "exec",
      "noop",
      "--event",
      "fixture.ready",
      "--agent-harness",
      "openai-tools",
      "--agent-model",
      "openrouter/z-ai/glm-5.2",
      "--agent-effort",
      "max",
    ]);
  });

  it("strips source-mode NODE_OPTIONS before invoking the dist CLI", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-node-options.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        "  nodeOptions: process.env.NODE_OPTIONS,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-node-options');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-node-options', workflow: 'noop', status: 'success',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );
    const previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--conditions=source --max-old-space-size=2048";
    try {
      const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
      const outcome = await executor.execute({
        workflowName: "noop",
        workingDir: dirs.workingDir,
        budgetMs: 5_000,
      });

      expect(outcome.kind).toBe("completed");
      const envCapture = JSON.parse(
        readFileSync(join(dirs.workingDir, "env.json"), "utf8"),
      ) as Record<string, string>;
      expect(envCapture.nodeOptions).toBe("--max-old-space-size=2048");
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
    }
  });

  it("reports the new terminal run when prior rounds used the same workflow", async () => {
    writeTerminalRun(dirs.workingDir, "builder", "run-1-builder-round", "success");
    const fakeKota = join(dirs.binariesDir, "kota-repeated-workflow.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-2-builder-round');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-2-builder-round', workflow: 'builder', status: 'success',",
        "  definitionPath: 'workflows/builder.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "builder",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    expect(outcome.runArtifactPath).toContain("run-2-builder-round");
    expect(outcome.runArtifactPath).not.toContain("run-1-builder-round");
  });

  it("pins replay runs to the claude preset so recordings override the active harness", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-env-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        `  preset: process.env.${PRESET_ENV_VAR},`,
        `  replayRoot: process.env.${REPLAY_AGENT_HARNESS_NAME_ENV},`,
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-replay');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-replay', workflow: 'noop', status: 'success',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({
      kotaBinaryPath: fakeKota,
      extraEnv: { [PRESET_ENV_VAR]: "codex" },
    });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
      replayRecordingsRoot: "/fixtures/replay",
    });

    expect(outcome.kind).toBe("completed");
    const envCapture = JSON.parse(
      readFileSync(join(dirs.workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.preset).toBe("claude");
    expect(envCapture.replayRoot).toBe("/fixtures/replay");
  });

  it("isolates machine authority from KOTA_SCOPE_ROOT inside the child process", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-home-capture.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "writeFileSync(join(process.cwd(), 'env.json'), JSON.stringify({",
        "  home: process.env.HOME,",
        "  workspaceRoot: process.env.KOTA_SCOPE_ROOT,",
        "}));",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-env');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-env', workflow: 'noop', status: 'success',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("completed");
    const envCapture = JSON.parse(
      readFileSync(join(dirs.workingDir, "env.json"), "utf8"),
    ) as Record<string, string>;
    expect(envCapture.home).toBe(
      join(dirs.workingDir, "node_modules", ".kota-eval-runtime", "home"),
    );
    expect(envCapture.workspaceRoot).toBe(dirs.workingDir);
  });

  it("reports error when the child exits non-zero", async () => {
    const fakeKota = join(dirs.binariesDir, "kota-fail.mjs");
    writeFakeKotaScript(
      fakeKota,
      [
        "import { mkdirSync, writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "const runDir = join(process.cwd(), '.kota', 'runs', 'run-1-noop-fail');",
        "mkdirSync(runDir, { recursive: true });",
        "writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({",
        "  metadataVersion: 1, id: 'run-1-noop-fail', workflow: 'noop', status: 'failed',",
        "  definitionPath: 'workflows/noop.ts', trigger: { event: 'eval.fixture', schemaRef: null, payload: {} }, startedAt: '2026-04-24T00:00:00.000Z', completedAt: '2026-04-24T00:00:01.000Z', runDir, steps: [],",
        "}));",
        "process.exit(3);",
      ].join("\n"),
    );

    const executor = createSubprocessExecutor({ kotaBinaryPath: fakeKota });
    const outcome = await executor.execute({
      workflowName: "noop",
      workingDir: dirs.workingDir,
      budgetMs: 5_000,
    });

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.message).toMatch(/status 3/);
      expect(outcome.message).toMatch(/failed/);
    }
  });
});
