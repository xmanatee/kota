import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAgentHarnessRegistryForTest, registerAgentHarness } from "#core/agent-harness/index.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "#modules/eval-harness/public-surface.js";
import { HOST_SUBPROCESS_NETWORK_POLICY } from "#modules/eval-harness/public-surface.js";
import { runHarnessParityMatrix } from "./harness-parity-operations.js";
import { createFixingHarness } from "./model-matrix.test-support.js";

const PROFILE: ResourceProfile = {
  hostClass: "matrix-test",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "non-gating",
  backendKind: "host-subprocess",
  requestedProfile: PROFILE,
  observedOrEnforcedProfile: PROFILE,
  verification: "observed",
  networkPolicy: HOST_SUBPROCESS_NETWORK_POLICY,
  gateEligible: false,
  nonGatingReason: "host-subprocess-unverified",
  diagnostics: [],
};

function writeEvalFixture(fixturesRoot: string): void {
  const dir = join(fixturesRoot, "eval-alpha");
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "fixture.json"),
    JSON.stringify({
      id: "eval-alpha",
      description: "eval alpha",
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [{ kind: "file-exists", path: "done.txt" }],
      preRunExpectations: [
        {
          predicate: { kind: "file-exists", path: "done.txt" },
          expected: "fail",
        },
      ],
      controlDecisions: ["act"],
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal matrix eval fixture coverage",
      },
    }),
  );
}

describe("harness-parity model matrix eval fixtures", () => {
  let evalFixturesRoot: string;
  let outRoot: string;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(createFixingHarness("openai-tools"));
    evalFixturesRoot = mkdtempSync(join(tmpdir(), "kota-matrix-eval-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-matrix-out-"));
    writeEvalFixture(evalFixturesRoot);
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    vi.unstubAllEnvs();
    rmSync(evalFixturesRoot, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("runs selected eval-harness fixtures with resource-profile evidence", async () => {
    const executionRequests: WorkflowExecutionRequest[] = [];
    const evalExecutor: WorkflowExecutor = {
      preflight: () => EXECUTION_PROFILE,
      execute: async (request) => {
        executionRequests.push(request);
        const { workingDir } = request;
        writeFileSync(join(workingDir, "done.txt"), "ok\n");
        const runDir = join(workingDir, ".kota", "runs", "noop");
        mkdirSync(join(runDir, "steps"), { recursive: true });
        const usage = { tokens: { state: "complete", inputTokens: 100, outputTokens: 20 }, cost: { state: "complete", usd: 0.03 } };
        writeFileSync(join(runDir, "metadata.json"), JSON.stringify({
          metadataVersion: 1, id: "noop", workflow: "noop", status: "success", runDir,
          definitionPath: "noop.ts", trigger: { event: "manual", schemaRef: null, payload: {} },
          startedAt: "2026-09-09T00:00:00.000Z", completedAt: "2026-09-09T00:00:01.000Z",
          steps: [{ id: "build", type: "agent", status: "success", usage, harness: "openai-tools", model: "ollama/test-model",
            startedAt: "2026-09-09T00:00:00.000Z", completedAt: "2026-09-09T00:00:01.000Z", durationMs: 1000,
            trajectoryDiagnostics: { artifactPath: "diagnostics.json", warningCount: 1, missingStreamingFramesCount: 0, unsupportedTrajectoryCount: 0,
              missingFinalVerificationAfterEditCount: 1, repeatedIdenticalFailingCommandCount: 0, editAfterSuccessfulVerificationCount: 0, longPreambleWithoutTaskTouchCount: 0 },
          }],
        }));
        writeFileSync(join(runDir, "steps", "build.events.jsonl"), [
          { type: "text", text: "Implement the requested file, then verify it." },
          { type: "tool_call", toolUseId: "a", toolName: "ask_owner", input: {} },
          { type: "tool_result", toolUseId: "a", isError: false, content: "approved" },
          { type: "result", numTurns: 3, usage, isError: false, text: "done" },
        ].map((event) => JSON.stringify(event)).join("\n"));
        return {
          kind: "completed",
          durationMs: 25,
          runArtifactPath: join(workingDir, ".kota", "runs", "noop"),
        };
      },
    };

    const result = await runHarnessParityMatrix(
      {
        scopeRoot: evalFixturesRoot,
        scenariosRoot: evalFixturesRoot,
        evalFixturesRoot,
        defaultOutBaseDir: outRoot,
        kotaBinaryPath: join(process.cwd(), "bin/kota.mjs"),
        config: {},
        evalExecutor,
      },
      {
        evalFixtures: ["eval-alpha"],
        baselines: [
          { label: "local-baseline", model: "ollama/test-model", provider: "local" },
        ],
        repeats: 1,
        maxTurns: 7,
        hostClass: "matrix-test",
        cpuAllocationCores: 2,
        memoryAllocationMB: 4096,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      targetKind: "eval-harness-fixture",
      scenarioId: "eval-alpha",
      harnessName: "openai-tools",
      model: "ollama/test-model",
      status: "passed",
      turns: 3,
      tokenUsage: { inputTokens: 100, outputTokens: 20 },
      estimatedCostUsd: 0.03,
      toolCounts: { toolCalls: 1, toolResults: 1 },
      approvalCounts: { approvalRequests: 1 },
      changedFiles: ["done.txt"],
      verification: { passed: true, timedOut: false },
      trajectoryDiagnostics: { warningCount: 1, missingStreamingFramesCount: 0, unsupportedTrajectoryCount: 0 },
      evalHarness: {
        resourceProfile: {
          hostClass: "matrix-test",
          cpuAllocationCores: 2,
          memoryAllocationMB: 4096,
        },
        executionProfile: {
          status: "non-gating",
          reason: "host-subprocess-unverified",
        },
      },
    });
    expect(result.groups[0]).toMatchObject({
      targetKind: "eval-harness-fixture",
      scenarioId: "eval-alpha",
      passAtK: 1,
      passHatK: 1,
    });
    const evidenceDir = result.rows[0]!.artifactDir!;
    expect(existsSync(executionRequests[0]!.workingDir)).toBe(false);
    expect(readFileSync(join(evidenceDir, "trace-summary.md"), "utf8")).toContain("Implement the requested file");
    expect(readFileSync(join(evidenceDir, "diff.patch"), "utf8")).toContain("+ok");
    expect(JSON.parse(readFileSync(join(evidenceDir, "measurements.json"), "utf8")).issues).toEqual([]);
    expect(executionRequests).toHaveLength(1);
    expect(executionRequests[0]?.agentExecutionOverride).toEqual({
      harness: "openai-tools",
      model: "ollama/test-model",
      maxTurns: 7,
      harnessOptions: { reasoning: "provider-default" },
    });

    const report = JSON.parse(readFileSync(result.reportPath, "utf-8")) as {
      scenarios: string[];
      evalFixtures: string[];
      evalResourceProfile: { hostClass: string };
    };
    expect(report.scenarios).toEqual([]);
    expect(report.evalFixtures).toEqual(["eval-alpha"]);
    expect(report.evalResourceProfile.hostClass).toBe("matrix-test");
  });
  it("carries source-scope candidate credentials through the default eval subprocess", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "matrix-subprocess-test-key");
    const binary = join(outRoot, "kota.mjs");
    writeFileSync(binary, `
      import { mkdirSync, writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      if (process.env.OPENROUTER_API_KEY !== 'matrix-subprocess-test-key') process.exit(2);
      const argv = process.argv.slice(2);
      const controls = JSON.parse(argv[argv.indexOf('--agent-options') + 1]);
      if (controls.maxTurns !== 4 || controls.modelOutputTokenLimits['openrouter/moonshotai/kimi-k2.7-code'] !== 2048) process.exit(3);
      writeFileSync(join(process.cwd(), 'done.txt'), 'ok');
      const runDir = join(process.cwd(), '.kota', 'runs', 'eval-subprocess');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'metadata.json'), JSON.stringify({
        metadataVersion: 1, id: 'eval-subprocess', workflow: 'noop', status: 'success', runDir,
        definitionPath: 'noop.ts', trigger: { event: 'manual', schemaRef: null, payload: {} },
        startedAt: '2026-09-09T00:00:00.000Z', completedAt: '2026-09-09T00:00:01.000Z', steps: []
      }));
    `);
    const result = await runHarnessParityMatrix({
      scopeRoot: evalFixturesRoot, scenariosRoot: evalFixturesRoot, evalFixturesRoot,
      defaultOutBaseDir: join(outRoot, "matrix"), kotaBinaryPath: binary,
      config: { modelOutputTokenLimits: { "openrouter/moonshotai/kimi-k2.7-code": 2048 } },
    }, {
      evalFixtures: ["eval-alpha"], maxTurns: 4,
      baselines: [{ model: "openrouter/moonshotai/kimi-k2.7-code", provider: "openrouter" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.status).toBe("passed");
    expect(result.rows[0]?.estimatedCostUsd).toBeNull();
    expect(result.rows[0]?.artifactDir).toBeUndefined();
    expect(readFileSync(result.reportPath, "utf8")).not.toContain("matrix-subprocess-test-key");
  });

});
