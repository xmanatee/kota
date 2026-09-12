import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearAgentHarnessRegistryForTest, registerAgentHarness, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ProcessSupervisorOptions } from "#core/execution/process-supervisor.js";
import { containedEvaluationProfiles } from "#modules/eval-harness/contained-evaluation.js";
import { writeFakeContainerBackend, writeTerminalRun } from "#modules/eval-harness/subprocess-executor-test-helpers.js";
import { containedMatrixRequest, containedMatrixSelection, containedMatrixTool, type PreparedContainedMatrix, prepareContainedMatrix, runContainedMatrix } from "./contained-matrix.js";
import { CONTAINED_STAGE_RESULT_PREFIX, decodeContainedStageOutput } from "./contained-stage-protocol.js";
import { createFixingHarness, writeFixAddScenario } from "./model-matrix.test-support.js";

// Only the external subprocess port is controlled. Matrix pairing, fixture
// materialization, scoring, artifact assembly and cleanup use production owners.
const processPort = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("#core/execution/process-supervisor.js", async (original) => ({
  ...await original<typeof import("#core/execution/process-supervisor.js")>(),
  ProcessSupervisor: class { constructor(private options: ProcessSupervisorOptions) {} run() { return processPort.run(this.options); } },
}));
let root: string;
let docker: string;
const backend = (provider = "openrouter") => ({ kind: "container" as const, executable: docker, image: "test:image", kotaBinaryPath: "/opt/kota/bin/kota.mjs",
  networkPolicy: { kind: "provider-egress" as const, provider, enforcement: { kind: "docker-internal-proxy" as const, networkName: "test-net", proxyUrl: "http://test-proxy:8080" } } });
const matrix = () => ({ baselines: [{ label: "baseline", model: "openrouter/z-ai/glm-5.2", provider: "openrouter" }],
  candidates: [{ label: "candidate", model: "openrouter/deepseek/deepseek-v4-flash", provider: "openrouter" }],
  harnesses: ["openai-tools"], harnessesByLabel: { baseline: ["openai-tools"], candidate: ["openai-tools"] }, scenarios: ["fix-arithmetic-bug"], evalFixtures: [], evalIsolationBackends: { openrouter: backend() } });
const profile = () => ({ scopeRoots: [root], preset: "openrouter", matrix: matrix(), maxRepeats: 3, timeoutMs: 30000,
  cpuCores: 1, memoryMB: 512, isolationBackend: backend() });
function hostProfile() {
  const profiles = { rollout: profile() };
  vi.stubEnv("KOTA_EVAL_CONTAINED_PROFILES", JSON.stringify(profiles));
  return containedEvaluationProfiles(root).rollout!;
}
function context() { return { scopeRoot: root, cwd: root, agentOutputDir: root, toolUseId: "matrix-call", signal: new AbortController().signal,
  onProcessSpawn: vi.fn(), workflow: { workflowName: "builder", runId: "origin-run", stepId: "build", spanId: "span", scopeId: deriveDirectoryScopeId(root) } }; }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "contained-matrix-"));
  docker = join(root, "docker.mjs"); writeFakeContainerBackend(docker);
  clearAgentHarnessRegistryForTest(); registerAgentHarness(createFixingHarness("openai-tools"));
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
  processPort.run.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); clearAgentHarnessRegistryForTest(); rmSync(root, { recursive: true, force: true }); });

it("keeps model, scope, image, output and resource grants host-owned", async () => {
  hostProfile();
  expect(() => containedMatrixRequest.parse({ operation: "run", profile: "rollout", image: "other", candidates: ["other"] })).toThrow();
  expect(() => containedMatrixSelection.parse({ ...matrix(), outDir: "/host" })).toThrow();
  expect(() => containedMatrixSelection.parse({ ...matrix(), evalIsolationBackends: { openrouter: { kind: "host-subprocess" } } })).toThrow();
  await expect(containedMatrixTool.runner({ operation: "run", profile: "rollout", repeatCount: 4 }, context())).rejects.toThrow("repeat count");
  await expect(containedMatrixTool.runner({ operation: "run", profile: "other" }, context())).rejects.toThrow("not authorized");
  const outside = join(root, "outside"); mkdirSync(outside);
  const ctx = context();
  await expect(containedMatrixTool.runner({ operation: "run", profile: "rollout" }, { ...ctx, scopeRoot: outside, workflow: { ...ctx.workflow, scopeId: deriveDirectoryScopeId(outside) } })).rejects.toThrow("not authorized");
  expect(processPort.run).not.toHaveBeenCalled();
  const inspected = await containedMatrixTool.runner({ operation: "inspect", profile: "rollout" }, context());
  expect(JSON.parse(inspected.content as string).selection.candidates[0].model).toBe("openrouter/deepseek/deepseek-v4-flash");
});

it("prepares exact native and local raw/scaffold routes without serializing host execution authority", () => {
  const login = join(root, "login.json"); writeFileSync(login, "synthetic-login");
  registerAgentHarness({ ...createFixingHarness("codex"), modelRouting: { kind: "native", provider: "openai" }, toolControl: "native",
    validateModelId: undefined, resolveIsolatedContainerAuth: () => ({ sourceFile: login, containerDirectory: "/run/login", fileName: "auth.json", locatorEnvKey: "CODEX_HOME" }) });
  registerAgentHarness(createFixingHarness("openai-tools-scaffold"));
  const input: Omit<ReturnType<typeof profile>, "matrix"> & { matrix: unknown } = profile();
  input.matrix = { ...matrix(), baselines: [{ label: "baseline", model: "gpt-5.5", provider: "openai" }],
    candidates: [{ label: "local", model: "ollama/installed-model", provider: "local" }],
    harnesses: ["codex", "openai-tools", "openai-tools-scaffold"], harnessesByLabel: { baseline: ["codex"], local: ["openai-tools", "openai-tools-scaffold"] }, evalIsolationBackends: { openai: backend("openai"), ollama: backend("ollama") } };
  vi.stubEnv("KOTA_EVAL_CONTAINED_PROFILES", JSON.stringify({ rollout: input }));
  const prepared = prepareContainedMatrix(root, join(root, "result"), containedEvaluationProfiles(root).rollout!, 3);
  expect(prepared.executions.map((row) => [row.harness.name, row.spec.model])).toEqual([
    ["codex", "gpt-5.5"], ["openai-tools", "ollama/installed-model"], ["openai-tools-scaffold", "ollama/installed-model"],
  ]);
  expect(prepared.executions[0]!.executorOptions.containerAuth?.sourceFile).toBe(login);
  expect(prepared.executions[1]!.executorOptions.extraEnv).not.toHaveProperty("OPENROUTER_API_KEY");
  expect(() => structuredClone(prepared)).not.toThrow();
});

function prepare(): PreparedContainedMatrix {
  const prepared = prepareContainedMatrix(root, join(root, "report"), hostProfile(), 2);
  const scenarios = join(root, "scenarios"); writeFixAddScenario(scenarios);
  const path = join(scenarios, "fix-add", "scenario.json"); const scenario = JSON.parse(readFileSync(path, "utf8"));
  scenario.verification.trustedFiles = []; writeFileSync(path, JSON.stringify(scenario));
  prepared.deps.scenariosRoot = scenarios; prepared.options.scenarios = ["fix-add"];
  return prepared;
}

it("executes equal paired repeats through contained launches and offline verifiers using the existing matrix report", async () => {
  const { PROVIDER_EGRESS_NETWORK_LABELS: labels, providerEgressEndpointLabelValue, providerEgressEndpointsFor } = await import("#modules/eval-harness/provider-egress.js");
  vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", JSON.stringify({ [labels.policy]: "provider-egress", [labels.provider]: "openrouter", [labels.endpoints]: providerEgressEndpointLabelValue(providerEgressEndpointsFor("openrouter")) }));
  const launches: ProcessSupervisorOptions[] = [];
  processPort.run.mockImplementation(async (options: ProcessSupervisorOptions) => {
    launches.push(options);
    options.signal?.throwIfAborted();
    const args = [...options.args];
    if (args.includes("workflow")) {
      writeTerminalRun(options.cwd, "noop", "controlled-fixture", "success");
      writeFileSync(join(options.cwd, "done.txt"), "ok");
      return { status: "completed", exitCode: 0, signal: null, stdout: { text: "", totalBytes: 0, truncated: false }, stderr: { text: "", totalBytes: 0, truncated: false } };
    }
    expect(args).toContain("contained-stage");
    const env = Object.fromEntries(readFileSync(args[args.indexOf("--env-file") + 1]!, "utf8").trim().split("\n").map((line) => {
      const split = line.indexOf("="); return [line.slice(0, split), line.slice(split + 1)];
    }));
    expect(env.KOTA_SCOPE_ROOT).toBe(env.HOME);
    expect(env.KOTA_SCOPE_ROOT).not.toBe(options.cwd);
    mkdirSync(join(env.KOTA_SCOPE_ROOT!, ".kota"), { recursive: true });
    writeFileSync(join(env.KOTA_SCOPE_ROOT!, ".kota", "session-evidence"), "runtime state");
    const request = JSON.parse(args.at(-1)!);
    expect(request.harness).toBe("openai-tools");
    writeFileSync(join(options.cwd, "add.js"), "exports.add = (a, b) => a + b;\n");
    const text = `${CONTAINED_STAGE_RESULT_PREFIX}${JSON.stringify({ result: { text: "done", streamedText: "done", turns: 1, usage: UNKNOWN_AGENT_USAGE, isError: false }, messages: [] })}\n`;
    return { status: "completed", exitCode: 0, signal: null, stdout: { text, totalBytes: text.length, truncated: false }, stderr: { text: "", totalBytes: 0, truncated: false } };
  });
  const prepared = prepare();
  const fixture = join(root, "fixtures", "eval-alpha"); mkdirSync(join(fixture, "initial"), { recursive: true });
  writeFileSync(join(fixture, "fixture.json"), JSON.stringify({ id: "eval-alpha", description: "contained fixture composition", role: "builder", workflowName: "noop", budgetMs: 30000,
    predicates: [{ kind: "file-exists", path: "done.txt" }], preRunExpectations: [{ predicate: { kind: "file-exists", path: "done.txt" }, expected: "fail" }],
    controlDecisions: ["act"], provenance: { kind: "smoke-fixture", justification: "Tests composition of contained matrix with the existing fixture runner." } }));
  prepared.deps.evalFixturesRoot = join(root, "fixtures"); prepared.options.evalFixtures = ["eval-alpha"];
  const result = await runContainedMatrix(prepared, { signal: new AbortController().signal, reportProgress: () => {}, onProcessSpawn: () => {} });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) return;
  expect(result.rows.filter((row) => row.targetKind === "harness-parity-scenario").map((row) => [row.label, row.repeatIndex, row.status])).toEqual([
    ["baseline", 0, "passed"], ["baseline", 1, "passed"], ["candidate", 0, "passed"], ["candidate", 1, "passed"],
  ]);
  expect(result.groups.every((group) => group.passHatK === 1)).toBe(true);
  expect(result.rows.filter((row) => row.targetKind === "eval-harness-fixture").map((row) => row.status)).toEqual(["passed", "passed", "passed", "passed"]);
  expect(launches).toHaveLength(8);
  for (const launch of launches) {
    expect(launch.args).toContain("test-net");
    const envFile = launch.args[launch.args.indexOf("--env-file") + 1]!;
    expect(existsSync(envFile)).toBe(false);
    expect(existsSync(launch.cwd)).toBe(false);
  }
  expect(JSON.parse(readFileSync(result.reportPath, "utf8")).repeats).toBe(2);
});

it("rejects missing images and cancellation before any candidate or host fallback", async () => {
  const prepared = prepare();
  for (const execution of prepared.executions) {
    if (execution.executorOptions.isolationBackend?.kind === "container") execution.executorOptions.isolationBackend.image = "missing:image";
  }
  const result = await runContainedMatrix(prepared, { signal: new AbortController().signal, reportProgress: () => {} });
  expect(result).toMatchObject({ ok: false, reason: "eval_preflight_failed" });
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await expect(runContainedMatrix(prepared, { signal: abort.signal, reportProgress: () => {} })).rejects.toThrow("cancelled");
  expect(processPort.run).not.toHaveBeenCalled();
});

it("rejects malformed or duplicate stage evidence instead of treating it as a pass", () => {
  expect(() => decodeContainedStageOutput("nothing")).toThrow("exactly one");
  expect(() => decodeContainedStageOutput(`${CONTAINED_STAGE_RESULT_PREFIX}{}\n${CONTAINED_STAGE_RESULT_PREFIX}{}`)).toThrow("exactly one");
  expect(() => decodeContainedStageOutput(`${CONTAINED_STAGE_RESULT_PREFIX}{"result":{"turns":-1},"messages":[]}`)).toThrow();
});

it("rejects a retained candidate symlink before runtime home mutation", async () => {
  const { containerExecutionEnv } = await import("#modules/eval-harness/subprocess-executor-env.js");
  const outside = join(root, "host"); mkdirSync(outside); writeFileSync(join(outside, "sentinel"), "safe");
  const working = join(root, "candidate"); mkdirSync(working); symlinkSync(outside, join(working, "node_modules"));
  const { OFFLINE_CONTAINER_NETWORK_POLICY } = await import("#modules/eval-harness/provider-egress.js");
  expect(() => containerExecutionEnv({ kotaBinaryPath: "unused" }, { workingDir: working, workflowName: "unused", budgetMs: 1 }, "/opt/kota/dist", OFFLINE_CONTAINER_NETWORK_POLICY)).toThrow("real directory");
  expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("safe");
  expect(existsSync(join(outside, ".kota-eval-runtime"))).toBe(false);
});

it("propagates in-flight cancellation and removes the contained launch before returning", async () => {
  const { PROVIDER_EGRESS_NETWORK_LABELS: labels, providerEgressEndpointLabelValue, providerEgressEndpointsFor } = await import("#modules/eval-harness/provider-egress.js");
  vi.stubEnv("KOTA_FAKE_CONTAINER_NETWORK_LABELS", JSON.stringify({ [labels.policy]: "provider-egress", [labels.provider]: "openrouter", [labels.endpoints]: providerEgressEndpointLabelValue(providerEgressEndpointsFor("openrouter")) }));
  const removed = join(root, "removed.txt"); vi.stubEnv("KOTA_FAKE_CONTAINER_REMOVE_LOG", removed);
  const abort = new AbortController();
  let launched: ProcessSupervisorOptions | undefined;
  processPort.run.mockImplementation(async (options: ProcessSupervisorOptions) => {
    launched = options;
    abort.abort(new Error("owner cancelled matrix"));
    expect(options.signal?.aborted).toBe(true);
    throw new Error("owner cancelled matrix");
  });
  await expect(runContainedMatrix(prepare(), { signal: abort.signal, reportProgress: () => {}, onProcessSpawn: () => {} })).rejects.toThrow("owner cancelled matrix");
  expect(launched).toBeDefined();
  const args = launched!.args;
  expect(readFileSync(removed, "utf8")).toContain(args[args.indexOf("--name") + 1]);
  expect(existsSync(args[args.indexOf("--env-file") + 1]!)).toBe(false);
  expect(existsSync(launched!.cwd)).toBe(false);
  expect(processPort.run).toHaveBeenCalledTimes(1);
});

it("requires explicit immutable verifier files and rejects candidate relocation before scoring", async () => {
  const { containedScenarioExecution } = await import("./contained-scenario.js");
  const { createSubprocessExecutor } = await import("#modules/eval-harness/subprocess-executor.js");
  const { validateIsolationBackend } = await import("#modules/eval-harness/eval-request-validation.js");
  const options = { kotaBinaryPath: "unused", isolationBackend: validateIsolationBackend({ ...backend(), networkPolicy: { kind: "offline" } }) };
  const execution = createSubprocessExecutor(options);
  const resources = { hostClass: "test", cpuAllocationCores: 1, cpuKillThresholdCores: 1, memoryAllocationMB: 512, memoryKillThresholdMB: 512 };
  const port = containedScenarioExecution(options, createFixingHarness("openai-tools"), execution.preflight(resources), 30000);
  const initial = join(root, "initial"); const working = join(root, "working");
  mkdirSync(initial); mkdirSync(working);
  writeFileSync(join(initial, "verify.js"), "process.exit(1)");
  symlinkSync(join(root, "docker.mjs"), join(working, "verify.js"));
  await expect(port.verify(working, { command: "node verify.js", timeoutMs: 1000 }, initial)).rejects.toThrow("trustedFiles");
  await expect(port.verify(working, { command: "node verify.js", timeoutMs: 1000, trustedFiles: ["verify.js"] }, initial)).rejects.toThrow("regular file");
});

it("the image stage command calls the real harness entrypoint and returns decodable trajectory and usage", async () => {
  vi.stubEnv("KOTA_SCOPE_ROOT", root);
  const { Command } = await import("commander");
  const { registerContainedStageCommand } = await import("./contained-stage-command.js");
  const writer = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const command = new Command(); registerContainedStageCommand(command);
  const harness = createFixingHarness("image-stage");
  registerAgentHarness({ ...harness, async run(options) {
    expect(options.model).toBe("ollama/selected-local");
    expect(options.effort).toBe("high");
    expect(options.maxTurns).toBe(7);
    expect(options.modelOutputTokenLimits).toEqual({ "ollama/selected-local": 128 });
    options.onMessage?.({ type: "tool_call", toolUseId: "edit-1", toolName: "edit", input: { path: "target.js" } });
    return { text: "completed", streamedText: "completed", turns: 2, usage: UNKNOWN_AGENT_USAGE, isError: false };
  } });
  try {
    await command.parseAsync(["contained-stage", JSON.stringify({ harness: "image-stage", prompt: "fix the target", model: "ollama/selected-local", effort: "high", maxTurns: 7, modelOutputTokenLimits: { "ollama/selected-local": 128 } })], { from: "user" });
    const output = writer.mock.calls.map(([chunk]) => String(chunk)).join("");
    const decoded = decodeContainedStageOutput(output);
    expect(decoded.result).toMatchObject({ turns: 2, usage: UNKNOWN_AGENT_USAGE, isError: false });
    expect(decoded.messages).toContainEqual({ type: "tool_call", toolUseId: "edit-1", toolName: "edit", input: { path: "target.js" } });
  } finally { writer.mockRestore(); }
});
