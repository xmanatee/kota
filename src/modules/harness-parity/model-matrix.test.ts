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
import {
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import type {
  HarnessParityMatrixRow,
  HarnessParityMatrixScaffoldEvidence,
} from "./client.js";
import { runHarnessParityMatrix } from "./harness-parity-operations.js";
import {
  createFixingHarness,
  FIX_ADD_SCENARIO_ID,
  writeFixAddScenario,
} from "./model-matrix.test-support.js";

describe("harness-parity model matrix", () => {
  let scenariosRoot: string;
  let evalFixturesRoot: string;
  let outRoot: string;
  let savedOpenRouterKey: string | undefined;

  beforeEach(() => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(createFixingHarness("matrix-harness"));
    scenariosRoot = mkdtempSync(join(tmpdir(), "kota-matrix-scenarios-"));
    evalFixturesRoot = mkdtempSync(join(tmpdir(), "kota-matrix-eval-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-matrix-out-"));
    writeFixAddScenario(scenariosRoot);
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
      scopeRoot: evalFixturesRoot,
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
        scenarios: [FIX_ADD_SCENARIO_ID],
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
    expect(baselineRows[0]?.trajectoryDiagnostics).toMatchObject({
      warningCount: 1,
      missingStreamingFramesCount: 0,
      unsupportedTrajectoryCount: 0,
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
      rows: Array<
        Pick<
          HarnessParityMatrixRow,
          "status" | "skipReason" | "toolCounts" | "trajectoryDiagnostics"
        >
      >;
    };
    expect(report.openRouterPreflight.authResolver).toBe(
      "model-clients.resolveApiKey",
    );
    expect(report.openRouterPreflight.available).toBe(false);
    expect(report.rows.some((row) => row.status === "skipped")).toBe(true);
    expect(report.rows.find((row) => row.status === "passed")).toMatchObject({
      toolCounts: { toolCalls: 1, toolResults: 1 },
      trajectoryDiagnostics: {
        warningCount: 1,
        missingStreamingFramesCount: 0,
        unsupportedTrajectoryCount: 0,
      },
    });
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
        scenarios: [FIX_ADD_SCENARIO_ID],
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

  it("records scaffold support evidence for scaffold harness rows", async () => {
    registerAgentHarness(createFixingHarness("openai-tools-scaffold"));

    const result = await runHarnessParityMatrix(
      matrixDeps(),
      {
        scenarios: [FIX_ADD_SCENARIO_ID],
        harnesses: ["openai-tools-scaffold"],
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
    expect(result.rows).toHaveLength(2);
    const supportedEvidence = {
      harnessMode: "openai-tools-scaffold",
      taskClass: "general-coding",
      supportStatus: "supported",
      reason: 'scenario verifier passed for scaffold task class "general-coding"',
    } satisfies HarnessParityMatrixScaffoldEvidence;
    const experimentalEvidence = {
      harnessMode: "openai-tools-scaffold",
      taskClass: "general-coding",
      supportStatus: "experimental",
      reason:
        'scenario was not executed, so scaffold task class "general-coding" remains experimental',
    } satisfies HarnessParityMatrixScaffoldEvidence;

    const passedRow = result.rows.find((row) => row.status === "passed");
    const skippedRow = result.rows.find((row) => row.status === "skipped");
    expect(passedRow?.scaffoldEvidence).toEqual(supportedEvidence);
    expect(skippedRow?.skipReason).toBe("missing OPENROUTER_API_KEY");
    expect(skippedRow?.scaffoldEvidence).toEqual(experimentalEvidence);

    const report = JSON.parse(readFileSync(result.reportPath, "utf-8")) as {
      rows: Array<
        Pick<
          HarnessParityMatrixRow,
          "harnessName" | "scaffoldEvidence" | "status"
        >
      >;
    };
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          harnessName: "openai-tools-scaffold",
          status: "passed",
          scaffoldEvidence: supportedEvidence,
        }),
        expect.objectContaining({
          harnessName: "openai-tools-scaffold",
          status: "skipped",
          scaffoldEvidence: experimentalEvidence,
        }),
      ]),
    );
  });

  it("expands the shipped OpenRouter lab candidate set without requiring a key", async () => {
    const result = await runHarnessParityMatrix(
      matrixDeps(),
      {
        scenarios: [FIX_ADD_SCENARIO_ID],
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
