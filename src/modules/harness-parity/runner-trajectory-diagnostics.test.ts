import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScenarioAcrossHarnesses } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner trajectory diagnostics", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("diagnoses missing frames from a streaming-capable harness without changing verification", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness(
      "silent-streaming",
      (workingDir) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      { emitsAgentMessageStream: true },
    );

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifacts[0]!.verification.passed).toBe(true);

    const diagnostics = JSON.parse(
      readFileSync(
        join(artifacts[0]!.artifactDir, "trajectory-diagnostics.json"),
        "utf-8",
      ),
    );
    expect(diagnostics).toMatchObject({
      status: "supported",
      emitsAgentMessageStream: true,
      counts: {
        warningCount: 1,
        missingStreamingFramesCount: 1,
      },
      diagnostics: [
        {
          code: "missing_streaming_frames",
          frameIndexes: [],
        },
      ],
    });

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0]).toMatchObject({
      verificationPassed: true,
      trajectoryDiagnostics: {
        warningCount: 1,
        missingStreamingFramesCount: 1,
      },
    });
  });
});
