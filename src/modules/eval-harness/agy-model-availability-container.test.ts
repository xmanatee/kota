import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { antigravityCliAgentHarness } from "#modules/antigravity-cli-agent-harness/adapter.js";

registerAgentHarness(antigravityCliAgentHarness);

import {
  cleanupAgyModelEvaluationTestEnvironment,
  configureFakeCandidateContainer,
  tempDir,
} from "./agy-model-evaluation-test-support.js";
import { createEvalRunExecution } from "./eval-run-execution.js";

afterEach(cleanupAgyModelEvaluationTestEnvironment);

describe("AGY model availability container", () => {
  it("rejects unsupported subscription auth before container model discovery, including when API keys exist", () => {
    const runtimeDir = tempDir("kota-agy-production-runtime-");
    const containerLog = join(runtimeDir, "availability-container.jsonl");
    const options = configureFakeCandidateContainer(runtimeDir, containerLog);
    expect(() => createEvalRunExecution(process.cwd(), options, {
      [PRESET_ENV_VAR]: "antigravity-cli", GEMINI_API_KEY: "synthetic-key",
    })).toThrow(/subscription container authentication is unsupported/);
    expect(existsSync(containerLog)).toBe(false);
  });
});
