import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { runHarnessParityMatrix } from "./harness-parity-operations.js";

function writeScenario(scenariosRoot: string): void {
  const dir = join(scenariosRoot, "fix-add");
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id: "fix-add",
      description: "fix add",
      prompt: "fix add",
      verification: {
        command:
          "node -e \"require('./add.js').add(2,3)===5 || process.exit(1)\"",
        timeoutMs: 10_000,
      },
    }),
  );
  writeFileSync(
    join(dir, "initial", "add.js"),
    "exports.add = (a, b) => a - b;\n",
  );
}

function fixingHarness(name: string): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"] as const,
    askOwnerToolName: null,
    emitsAgentMessageStream: true,
    toolControl: "kota",
    async run(options: AgentHarnessRunOptions) {
      writeFileSync(
        join(options.cwd ?? process.cwd(), "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
      options.onMessage?.({
        type: "tool_call",
        toolUseId: "tool-1",
        toolName: "edit",
        input: { path: "add.js" },
      });
      options.onMessage?.({
        type: "tool_result",
        toolUseId: "tool-1",
        isError: false,
        content: "ok",
      });
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
        inputTokens: 10,
        outputTokens: 5,
        totalCostUsd: 0.002,
      };
    },
  };
}

describe("harness-parity model matrix", () => {
  let scenariosRoot: string;
  let evalFixturesRoot: string;
  let outRoot: string;
  let savedOpenRouterKey: string | undefined;

  beforeEach(() => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(fixingHarness("matrix-harness"));
    scenariosRoot = mkdtempSync(join(tmpdir(), "kota-matrix-scenarios-"));
    evalFixturesRoot = mkdtempSync(join(tmpdir(), "kota-matrix-eval-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-matrix-out-"));
    writeScenario(scenariosRoot);
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    if (savedOpenRouterKey !== undefined) {
      process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    rmSync(scenariosRoot, { recursive: true, force: true });
    rmSync(evalFixturesRoot, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });

  function matrixDeps() {
    return {
      projectDir: evalFixturesRoot,
      scenariosRoot,
      evalFixturesRoot,
      defaultOutBaseDir: outRoot,
      kotaBinaryPath: join(process.cwd(), "bin/kota.mjs"),
      config: {},
    };
  }

  it("runs local baseline rows and records no-key OpenRouter candidate skips", async () => {
    const result = await runHarnessParityMatrix(
      matrixDeps(),
      {
        scenarios: ["fix-add"],
        harnesses: ["matrix-harness"],
        baselines: [
          { label: "local-baseline", model: "test-model", provider: "local" },
        ],
        candidates: [
          {
            label: "glm",
            model: "openrouter/z-ai/glm-5.2",
            provider: "openrouter",
          },
        ],
        repeats: 2,
        effort: "high",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(4);
    const baselineRows = result.rows.filter((row) => row.role === "baseline");
    expect(baselineRows.map((row) => row.status)).toEqual([
      "passed",
      "passed",
    ]);
    expect(baselineRows[0]?.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(baselineRows[0]?.toolCounts).toEqual({
      toolCalls: 1,
      toolResults: 1,
    });

    const candidateRows = result.rows.filter((row) => row.role === "candidate");
    expect(candidateRows.map((row) => row.status)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(candidateRows[0]?.skipReason).toBe("missing OPENROUTER_API_KEY");
    expect(candidateRows[0]?.capabilityMetadata).toMatchObject({
      status: "available",
      observedAt: "2026-06-26T06:45:00.000Z",
    });

    expect(result.aggregate).toMatchObject({
      groupCount: 2,
      runnableGroupCount: 1,
      skippedGroupCount: 1,
      passAtK: 1,
      passHatK: 1,
    });
    expect(result.shadowComparisons).toHaveLength(1);
    expect(result.shadowComparisons[0]?.workspaceIsolation).toBe(
      "cloned-scenario-working-tree",
    );
    expect(result.shadowComparisons[0]?.compatible).toBe(false);
    expect(
      result.shadowComparisons[0]?.compatibilityChecks.find(
        (entry) => entry.name === "candidate-ran",
      ),
    ).toMatchObject({ passed: false });

    const report = JSON.parse(readFileSync(result.reportPath, "utf-8")) as {
      openRouterPreflight: { authResolver: string; available: boolean };
      rows: Array<{ status: string; skipReason?: string }>;
    };
    expect(report.openRouterPreflight.authResolver).toBe(
      "model-clients.resolveApiKey",
    );
    expect(report.openRouterPreflight.available).toBe(false);
    expect(report.rows.some((row) => row.status === "skipped")).toBe(true);
  });

  it("runs OpenRouter candidates when the key is stored in project setup secrets", async () => {
    mkdirSync(join(evalFixturesRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(evalFixturesRoot, ".kota", "secrets.json"),
      `${JSON.stringify({ OPENROUTER_API_KEY: "sk-or-project" })}\n`,
    );

    const result = await runHarnessParityMatrix(
      matrixDeps(),
      {
        scenarios: ["fix-add"],
        harnesses: ["matrix-harness"],
        baselines: [
          { label: "local-baseline", model: "test-model", provider: "local" },
        ],
        candidates: [
          {
            label: "glm",
            model: "openrouter/z-ai/glm-5.2",
            provider: "openrouter",
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const candidateRows = result.rows.filter((row) => row.role === "candidate");
    expect(candidateRows).toHaveLength(1);
    expect(candidateRows[0]).toMatchObject({
      provider: "openrouter",
      status: "passed",
    });
    expect(candidateRows[0]?.skipReason).toBeUndefined();

    const report = JSON.parse(readFileSync(result.reportPath, "utf-8")) as {
      openRouterPreflight: { authResolver: string; available: boolean };
      rows: Array<{ role: string; status: string; skipReason?: string }>;
    };
    expect(report.openRouterPreflight).toEqual({
      authEnv: "OPENROUTER_API_KEY",
      authResolver: "model-clients.resolveApiKey",
      available: true,
    });
    expect(
      report.rows.find((row) => row.role === "candidate"),
    ).toMatchObject({ status: "passed" });
  });

  it("expands the shipped OpenRouter lab candidate set without requiring a key", async () => {
    const result = await runHarnessParityMatrix(
      matrixDeps(),
      {
        scenarios: ["fix-add"],
        harnesses: ["matrix-harness"],
        baselines: [
          { label: "local-baseline", model: "test-model", provider: "local" },
        ],
        candidateSets: ["openrouter-lab"],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const skippedModels = result.rows
      .filter((row) => row.status === "skipped")
      .map((row) => row.model);
    expect(skippedModels).toContain("openrouter/z-ai/glm-5.2");
    expect(skippedModels).toContain("openrouter/moonshotai/kimi-k2.7-code");
  });

});
