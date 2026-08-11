import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import "#modules/antigravity-cli-agent-harness/index.js";
import { runAgyModelsCommand } from "./agy-model-availability.js";
import {
  cleanupAgyModelEvaluationTestEnvironment,
  configureFakeCandidateContainer,
  tempDir,
} from "./agy-model-evaluation-test-support.js";
import { createEvalRunExecution } from "./eval-run-execution.js";

afterEach(cleanupAgyModelEvaluationTestEnvironment);

describe("AGY model availability container", () => {
  it("probes models through the production candidate container execution", () => {
    const runtimeDir = tempDir("kota-agy-production-runtime-");
    const containerLog = join(runtimeDir, "availability-container.jsonl");
    const options = configureFakeCandidateContainer(runtimeDir, containerLog);
    const execution = createEvalRunExecution(process.cwd(), options, {
      ...process.env,
      [PRESET_ENV_VAR]: "antigravity-cli",
    });

    expect(runAgyModelsCommand(execution)).toMatchObject({
      status: 0,
      stdout: expect.stringContaining("gemini-3.6-flash-high"),
    });
    expect(execution.isolationBackend).toEqual(options.isolationBackend);
    expect(
      execution.executor.predicateContext?.executableVerifierSandbox,
    ).toMatchObject({
      kind: "oci-container",
      command: options.isolationBackend.executable,
      image: "kota-eval:latest",
    });
    const invocation = JSON.parse(
      readFileSync(containerLog, "utf8").trim(),
    ) as { command: string; commandArgs: string[] };
    expect(invocation).toMatchObject({
      command: "agy",
      commandArgs: ["models"],
    });
  });
});
