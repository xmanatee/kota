import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "#modules/eval-harness/public-surface.js";
import { HOST_SUBPROCESS_NETWORK_POLICY } from "#modules/eval-harness/public-surface.js";
import { runHarnessParityMatrix } from "./harness-parity-operations.js";

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
    evalFixturesRoot = mkdtempSync(join(tmpdir(), "kota-matrix-eval-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-matrix-out-"));
    writeEvalFixture(evalFixturesRoot);
  });

  afterEach(() => {
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
        return {
          kind: "completed",
          durationMs: 25,
          runArtifactPath: join(workingDir, ".kota", "runs", "noop"),
        };
      },
    };

    const result = await runHarnessParityMatrix(
      {
        projectDir: evalFixturesRoot,
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
          { label: "local-baseline", model: "test-model", provider: "local" },
        ],
        repeats: 1,
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
      model: "test-model",
      status: "passed",
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
    expect(executionRequests).toHaveLength(1);
    expect(executionRequests[0]?.agentExecutionOverride).toEqual({
      harness: "openai-tools",
      model: "test-model",
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
});
