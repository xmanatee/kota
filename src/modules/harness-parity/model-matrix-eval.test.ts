import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentHarness, clearAgentHarnessRegistryForTest, registerAgentHarness } from "#core/agent-harness/index.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
  WorkflowExecutionRequest,
  WorkflowExecutor,
} from "#modules/eval-harness/public-surface.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY, PROVIDER_EGRESS_NETWORK_LABELS, providerEgressEndpointLabelValue, providerEgressEndpointsFor } from "#modules/eval-harness/public-surface.js";
import { createFakeExecutableVerifierSandbox, writeFakeContainerBackend } from "#modules/eval-harness/subprocess-executor-test-helpers.js";
import type { HarnessParityMatrixOptions, HarnessParityMatrixResult } from "./client.js";
import { type HarnessParityDeps, runHarnessParityMatrix } from "./harness-parity-operations.js";
import { createFixingHarness, writeFixAddScenario } from "./model-matrix.test-support.js";
import { validateMatrixIsolationBackends } from "./model-matrix-isolation.js";
import { harnessParityControlRoutes } from "./routes.js";

async function invokeMatrixRoute(deps: HarnessParityDeps, options: HarnessParityMatrixOptions): Promise<HarnessParityMatrixResult> {
  const req = Readable.from([Buffer.from(JSON.stringify(options))]) as IncomingMessage;
  let result: HarnessParityMatrixResult | undefined;
  const res = {
    writeHead() {},
    setHeader() {},
    end(body: string) { result = JSON.parse(body); },
  } as unknown as ServerResponse;
  const route = harnessParityControlRoutes(deps).find((entry) => entry.path === "/harness-parity/matrix")!;
  await route.handler(req, res, {});
  if (result === undefined) throw new Error("Matrix route did not respond");
  return result;
}

const PROFILE: ResourceProfile = {
  hostClass: "matrix-test",
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4096,
  memoryKillThresholdMB: 4096,
};

const EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: PROFILE,
  observedOrEnforcedProfile: PROFILE,
  verification: "enforced",
  networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
  gateEligible: true,
  eligibilityReason: "verified-profile",
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
  let verifier: ReturnType<typeof createFakeExecutableVerifierSandbox>;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(createFixingHarness("openai-tools"));
    evalFixturesRoot = mkdtempSync(join(tmpdir(), "kota-matrix-eval-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-matrix-out-"));
    writeEvalFixture(evalFixturesRoot);
    verifier = createFakeExecutableVerifierSandbox();
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    verifier.cleanup();
    vi.unstubAllEnvs();
    rmSync(evalFixturesRoot, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("runs selected eval-harness fixtures with resource-profile evidence", async () => {
    const executionRequests: WorkflowExecutionRequest[] = [];
    const evalExecutor: WorkflowExecutor = {
      predicateContext: { executableVerifierSandbox: verifier.sandbox },
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
          steps: [{ id: "build", type: "agent", status: "success", usage, harness: "openai-tools", model: "openai/test-model",
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
          { label: "baseline", model: "openai/test-model", provider: "openai" },
        ],
        repeats: 1,
        maxTurns: 7,
        hostClass: "matrix-test",
        cpuAllocationCores: 2,
        memoryAllocationMB: 4096,
      },
    );

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      targetKind: "eval-harness-fixture",
      scenarioId: "eval-alpha",
      harnessName: "openai-tools",
      model: "openai/test-model",
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
          status: "verified",
          reason: "verified-profile",
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
      model: "openai/test-model",
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
  it("routes candidate credentials, controls and offline scoring through the configured container", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "matrix-subprocess-test-key");
    clearAgentHarnessRegistryForTest();
    registerAgentHarness({
      ...createFixingHarness("openai-tools"),
      resolveIsolatedHostAuthEnv: () => ({ HOST_LOGIN_LOCATOR: "/host/private/login" }),
    });
    const fixturePath = join(evalFixturesRoot, "eval-alpha", "fixture.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    fixture.predicates.push({ kind: "shell-succeeds", command: 'test "$(cat done.txt)" = ok && test -z "$OPENROUTER_API_KEY"', timeoutMs: 5000 });
    const calibration = join(evalFixturesRoot, "eval-alpha", "calibration");
    mkdirSync(calibration);
    writeFileSync(join(calibration, "golden.txt"), "ok");
    writeFileSync(join(calibration, "adversarial.txt"), "incorrect");
    fixture.verifierCalibration = {
      null: { setup: [] },
      golden: { setup: [{ kind: "copy-fixture-file", sourcePath: "calibration/golden.txt", targetPath: "done.txt" }] },
      adversarial: { setup: [{ kind: "copy-fixture-file", sourcePath: "calibration/adversarial.txt", targetPath: "done.txt" }] },
    };
    writeFileSync(fixturePath, JSON.stringify(fixture));
    const binary = join(outRoot, "kota.mjs");
    const container = join(outRoot, "docker.mjs");
    const log = join(outRoot, "container.jsonl");
    writeFakeContainerBackend(container);
    // The verifier deliberately strips test environment variables too. Configure
    // this controlled process port itself so offline launches remain observable.
    writeFileSync(container, readFileSync(container, "utf8").replaceAll(
      "process.env.KOTA_FAKE_CONTAINER_LOG", JSON.stringify(log),
    ));
    vi.stubEnv("KOTA_FAKE_CONTAINER_LOG", log);
    vi.stubEnv("KOTA_FAKE_CONTAINER_USE_HOST_PATH", "1");
    vi.stubEnv("KOTA_FAKE_CONTAINER_KOTA_BINARY_SOURCE", binary);
    vi.stubEnv("KOTA_FAKE_CONTAINER_KOTA_BINARY_PATH", "/opt/kota/bin/kota.mjs");
    vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", JSON.stringify({
      [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
      [PROVIDER_EGRESS_NETWORK_LABELS.provider]: "openrouter",
      [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]: providerEgressEndpointLabelValue(providerEgressEndpointsFor("openrouter")),
    }));
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
    const result = await invokeMatrixRoute({
      scopeRoot: evalFixturesRoot, scenariosRoot: evalFixturesRoot, evalFixturesRoot,
      defaultOutBaseDir: join(outRoot, "matrix"), kotaBinaryPath: binary,
      config: { modelOutputTokenLimits: { "openrouter/moonshotai/kimi-k2.7-code": 2048 } },
    }, {
      evalFixtures: ["eval-alpha"], maxTurns: 4, repeats: 2, ...PROFILE,
      evalIsolationBackends: { openrouter: {
        kind: "container", executable: container, image: "kota-eval:test", kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: { kind: "provider-egress", provider: "openrouter", enforcement: {
          kind: "docker-internal-proxy", networkName: "openrouter-test", proxyUrl: "http://provider-proxy:8080",
        } },
      } },
      baselines: [{ model: "openrouter/moonshotai/kimi-k2.7-code", provider: "openrouter" }],
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.status)).toEqual(["passed", "passed"]);
    const launches = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const candidates = launches.filter((entry) => entry.command === "node");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((entry) => entry.workdir)[0]).not.toBe(candidates[1].workdir);
    for (const candidate of candidates) {
      expect(candidate.args).toEqual(expect.arrayContaining(["--network", "openrouter-test", "--cpus", "2", "--memory", "4096m"]));
      expect(candidate.commandArgs.slice(0, 4)).toEqual(["/opt/kota/bin/kota.mjs", "workflow", "exec", "noop"]);
      expect(candidate.env).toMatchObject({ OPENROUTER_API_KEY: "matrix-subprocess-test-key", KOTA_EVAL_PROVIDER_EGRESS_AGENT_HARNESS: "openai-tools" });
      expect(candidate.env).not.toHaveProperty("HOST_LOGIN_LOCATOR");
      expect(candidate.envFiles.every((path: string) => !existsSync(path))).toBe(true);
    }
    const scorers = launches.filter((entry) => entry.command === "/bin/sh");
    expect(scorers.length).toBeGreaterThan(0);
    expect(scorers.every((entry) => entry.args.includes("none") && entry.env.OPENROUTER_API_KEY === undefined)).toBe(true);
    expect(result.rows[0]?.evalHarness?.executionProfile).toMatchObject({
      backendKind: "container", gateEligible: false, reason: "provider-egress-task-boundary-unverified",
    });
    expect(result.rows[0]?.estimatedCostUsd).toBeNull();
    expect(result.rows[0]?.artifactDir).toBeUndefined();
    expect(readFileSync(result.reportPath, "utf8")).not.toContain("matrix-subprocess-test-key");
  });

  it.each(["missing-backend", "missing:image", "host"])("stops unavailable isolation (%s) before any scenario inference", async (failure) => {
    vi.stubEnv("OPENROUTER_API_KEY", "matrix-test-key");
    const harness = createFixingHarness("openai-tools");
    const run = vi.spyOn(harness, "run");
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(harness);
    writeFixAddScenario(evalFixturesRoot);
    const container = join(outRoot, "docker.mjs");
    if (failure !== "missing-backend") writeFakeContainerBackend(container);
    const result = await runHarnessParityMatrix({
      scopeRoot: evalFixturesRoot, scenariosRoot: evalFixturesRoot, evalFixturesRoot,
      defaultOutBaseDir: outRoot, kotaBinaryPath: "unused", config: {},
    }, {
      scenarios: ["fix-add"], evalFixtures: ["eval-alpha"], ...PROFILE,
      baselines: [{ model: "openrouter/moonshotai/kimi-k2.7-code", provider: "openrouter" }],
      evalIsolationBackends: { openrouter: failure === "host" ? { kind: "host-subprocess" } : {
        kind: "container", executable: container, image: failure, kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      } },
    });
    expect(result).toMatchObject({ ok: false, reason: "eval_preflight_failed" });
    expect(run).not.toHaveBeenCalled();
    if (result.ok) return;
    const artifact = result.message.split("evidence: ")[1]!;
    expect(JSON.parse(readFileSync(artifact, "utf8"))).toMatchObject({
      provider: "openrouter", model: "openrouter/moonshotai/kimi-k2.7-code", harness: "openai-tools",
    });
  });

  it.each(["omitted", "offline"] as const)("rejects OpenRouter %s networking before candidate or scenario inference", async (policy) => {
    vi.stubEnv("OPENROUTER_API_KEY", "matrix-test-key");
    const harness = createFixingHarness("openai-tools");
    const run = vi.spyOn(harness, "run");
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(harness);
    writeFixAddScenario(evalFixturesRoot);
    const container = join(outRoot, "docker.mjs");
    const log = join(outRoot, "launches.jsonl");
    writeFakeContainerBackend(container);
    vi.stubEnv("KOTA_FAKE_CONTAINER_LOG", log);
    const result = await invokeMatrixRoute({
      scopeRoot: evalFixturesRoot, scenariosRoot: evalFixturesRoot, evalFixturesRoot,
      defaultOutBaseDir: outRoot, kotaBinaryPath: "unused", config: {},
    }, {
      scenarios: ["fix-add"], evalFixtures: ["eval-alpha"], ...PROFILE,
      baselines: [{ model: "openrouter/moonshotai/kimi-k2.7-code", provider: "openrouter" }],
      evalIsolationBackends: { openrouter: {
        kind: "container", executable: container, image: "ready-image", kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        ...(policy === "offline" ? { networkPolicy: { kind: "offline" } as const } : {}),
      } },
    });
    expect(result).toMatchObject({ ok: false, reason: "eval_preflight_failed" });
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(log)).toBe(false);
    if (result.ok) return;
    expect(JSON.parse(readFileSync(result.message.split("evidence: ")[1]!, "utf8"))).toMatchObject({
      provider: "openrouter", harness: harness.name, verifierIssue: null,
      executionProfile: { backendKind: "container", status: "verified", networkPolicy: { kind: "offline" } },
      routingIssue: expect.stringContaining("requires matching provider-egress"),
    });
  });

  it.each(["native", "ollama", "lmstudio"] as const)("rejects unsupported %s routing despite container readiness", async (route) => {
    const native = route === "native";
    const provider = native ? "openai" : route;
    const hostAuth = vi.fn(() => ({ CODEX_HOME: "/host/login" }));
    const harness: AgentHarness = {
      ...createFixingHarness(native ? "codex" : "openai-tools"),
      ...(native ? { modelRouting: { kind: "native", provider: "openai" } as const } : {}),
      resolveIsolatedHostAuthEnv: hostAuth,
    };
    const run = vi.spyOn(harness, "run");
    clearAgentHarnessRegistryForTest();
    registerAgentHarness(harness);
    vi.stubEnv("OPENAI_API_KEY", "not-native-login");
    writeFixAddScenario(evalFixturesRoot);
    const container = join(outRoot, "docker.mjs");
    const log = join(outRoot, "launches.jsonl");
    writeFakeContainerBackend(container);
    vi.stubEnv("KOTA_FAKE_CONTAINER_LOG", log);
    vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", JSON.stringify({
      [PROVIDER_EGRESS_NETWORK_LABELS.policy]: "provider-egress",
      [PROVIDER_EGRESS_NETWORK_LABELS.provider]: "openai",
      [PROVIDER_EGRESS_NETWORK_LABELS.endpoints]: providerEgressEndpointLabelValue(providerEgressEndpointsFor("openai")),
    }));
    const result = await invokeMatrixRoute({
      scopeRoot: evalFixturesRoot, scenariosRoot: evalFixturesRoot, evalFixturesRoot,
      defaultOutBaseDir: outRoot, kotaBinaryPath: "unused", config: {},
    }, {
      scenarios: ["fix-add"], evalFixtures: ["eval-alpha"], ...PROFILE,
      harnesses: [harness.name],
      baselines: [{ model: native ? "gpt-5.5" : `${provider}/installed-model`, provider: native ? "openai" : "local" }],
      evalIsolationBackends: { [provider]: {
        kind: "container", executable: container, image: "ready-image", kotaBinaryPath: "/opt/kota/bin/kota.mjs",
        networkPolicy: native ? { kind: "provider-egress", provider: "openai", enforcement: {
          kind: "docker-internal-proxy", networkName: "openai-test", proxyUrl: "http://provider-proxy:8080",
        } } : { kind: "offline" },
      } },
    });
    expect(result).toMatchObject({ ok: false, reason: "eval_preflight_failed" });
    expect(run).not.toHaveBeenCalled();
    expect(hostAuth).not.toHaveBeenCalled();
    expect(existsSync(log)).toBe(false);
    if (result.ok) return;
    const artifact = readFileSync(result.message.split("evidence: ")[1]!, "utf8");
    expect(JSON.parse(artifact)).toMatchObject({
      provider, harness: harness.name, verifierIssue: null,
      executionProfile: { backendKind: "container", status: native ? "non-gating" : "verified" },
      routingIssue: expect.stringContaining(native ? "owner-mediated container login" : "contained local-runtime route"),
    });
    expect(artifact).not.toContain("not-native-login");
  });

  it("rejects malformed isolation and a different provider's egress policy", () => {
    expect(() => validateMatrixIsolationBackends([])).toThrow(/map provider ids/);
    expect(() => validateMatrixIsolationBackends({ openrouter: { kind: "container", executable: "docker" } })).toThrow(/image/);
    expect(() => validateMatrixIsolationBackends({ openrouter: {
      kind: "container", executable: "docker", image: "eval", kotaBinaryPath: "/opt/kota/bin/kota.mjs",
      networkPolicy: { kind: "provider-egress", provider: "openai", enforcement: {
        kind: "docker-internal-proxy", networkName: "openai", proxyUrl: "http://proxy:8080",
      } },
    } })).toThrow(/must match execution provider/);
  });

});
