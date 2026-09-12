import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import type { ProcessOutcome, ProcessSupervisorOptions } from "#core/execution/process-supervisor.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { antigravityCliAgentHarness } from "#modules/antigravity-cli-agent-harness/adapter.js";
import { runAgyModelsCommand } from "./agy-model-availability.js";
import { cleanupAgyModelEvaluationTestEnvironment, configureFakeCandidateContainer, tempDir } from "./agy-model-evaluation-test-support.js";
import { createEvalRunExecution } from "./eval-run-execution.js";

const launch = vi.hoisted(() => vi.fn<(options: ProcessSupervisorOptions) => Promise<ProcessOutcome>>());
// Only the subprocess port is replaced. Profile, environment, resource naming,
// cancellation composition and cleanup use their production owners.
vi.mock("#core/execution/process-supervisor.js", () => ({
  ProcessSupervisor: class {
    constructor(private readonly options: ProcessSupervisorOptions) {}
    run() { return launch(this.options); }
  },
}));
registerAgentHarness(antigravityCliAgentHarness);
afterEach(() => { launch.mockReset(); cleanupAgyModelEvaluationTestEnvironment(); });

it("propagates availability cancellation and supervision and removes its temporary environment", async () => {
  const runtimeDir = tempDir("agy-availability-cancellation-");
  const options = configureFakeCandidateContainer(runtimeDir, join(runtimeDir, "container-log"));
  const controller = new AbortController();
  const onSpawn = vi.fn();
  const execution = createEvalRunExecution(process.cwd(), options, { ...process.env, [PRESET_ENV_VAR]: "antigravity-cli" }, controller.signal, onSpawn);
  launch.mockImplementation(async (request) => {
    request.onSpawn?.({ pid: 123, processGroupId: 123, osStartToken: "fixture", observedCommandHash: "availability" });
    return new Promise((resolve) => {
      request.signal!.addEventListener("abort", () => resolve({
        status: "aborted", identity: null, escalated: false, exitCode: null, signal: null,
        stdout: { text: "", totalBytes: 0, truncated: false },
        stderr: { text: "", totalBytes: 0, truncated: false },
      }), { once: true });
    });
  });
  const pending = runAgyModelsCommand(execution);
  const observed = expect(pending).rejects.toThrow("host deadline");
  await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  const request = launch.mock.calls[0]![0];
  const envFile = request.args[request.args.indexOf("--env-file") + 1]!;
  expect(existsSync(envFile)).toBe(true);
  expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ pid: 123 }));
  controller.abort(new Error("host deadline"));
  await observed;
  expect(existsSync(envFile)).toBe(false);
  expect(existsSync(request.cwd)).toBe(false);
});

it("returns the asynchronous container catalog through the existing availability surface", async () => {
  const runtimeDir = tempDir("agy-availability-result-");
  const options = configureFakeCandidateContainer(runtimeDir, join(runtimeDir, "container-log"));
  launch.mockResolvedValue({ status: "completed", exitCode: 0, signal: null,
    identity: { pid: 123, processGroupId: 123, osStartToken: "fixture", observedCommandHash: "availability" },
    stdout: { text: "candidate-high\n", totalBytes: 15, truncated: false }, stderr: { text: "", totalBytes: 0, truncated: false } });
  const execution = createEvalRunExecution(process.cwd(), options, { ...process.env, [PRESET_ENV_VAR]: "antigravity-cli" });
  expect(await runAgyModelsCommand(execution)).toMatchObject({ status: 0, stdout: "candidate-high\n" });
  expect(existsSync(launch.mock.calls[0]![0].cwd)).toBe(false);
});
