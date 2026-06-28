import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScenarioAcrossHarnesses, runScenarioOnHarness } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState, writeContextRetrievalScenario, writeStagedContextRetrievalScenario } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner context retrieval artifacts", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("writes context-retrieval diagnostics and parity summaries for declared scenarios", async () => {
    writeContextRetrievalScenario(scenariosRoot);
    const scenario = loadScenario(scenariosRoot, "context-fix-add");
    const harness = makeHarness(
      "context-clean",
      async (workingDir, options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "read-add",
          toolName: "Read",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "read-add",
          isError: false,
          content: readFileSync(join(workingDir, "add.js"), "utf-8"),
        });
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "edit-add",
          toolName: "Edit",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "edit-add",
          isError: false,
          content: "patched add.js",
        });
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

    const artifact = artifacts[0]!;
    const diagnosticsPath = join(
      artifact.artifactDir,
      "context-retrieval-diagnostics.json",
    );
    expect(artifact.contextRetrievalDiagnostics).toMatchObject({
      artifactPath: diagnosticsPath,
      status: "supported",
      expectedTargetCount: 1,
      reachedTargetCount: 1,
      missedTargetCount: 0,
      relevantRetrievalBeforeFirstEdit: true,
    });
    const diagnostics = JSON.parse(readFileSync(diagnosticsPath, "utf-8"));
    expect(diagnostics).toMatchObject({
      status: "supported",
      expectedTargets: [
        {
          id: "adder",
          reached: true,
          reachedBeforeFirstEdit: true,
        },
      ],
      missedTargets: [],
    });

    const parity = JSON.parse(
      readFileSync(join(outRoot, "context-fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].contextRetrievalDiagnostics).toMatchObject({
      artifactPath: diagnosticsPath,
      reachedTargetCount: 1,
      relevantRetrievalBeforeFirstEdit: true,
    });
    const summary = readFileSync(
      join(artifact.artifactDir, "trace-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("- contextRetrievalDiagnostics:");
  });

  it("writes staged context-retrieval diagnostics beside staged trajectory artifacts", async () => {
    writeStagedContextRetrievalScenario(scenariosRoot);
    const scenario = loadScenario(scenariosRoot, "staged-context-upgrade");
    const harness = makeHarness(
      "staged-context-clean",
      async (workingDir, options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: `read-${options.prompt.includes("stage 1") ? "v2" : "v3"}`,
          toolName: "Read",
          input: { path: "state.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: `read-${options.prompt.includes("stage 1") ? "v2" : "v3"}`,
          isError: false,
          content: readFileSync(join(workingDir, "state.js"), "utf-8"),
        });
        if (options.prompt.includes("stage 1")) {
          writeFileSync(join(workingDir, "state.js"), 'exports.state = () => "v2";\n');
          return;
        }
        writeFileSync(join(workingDir, "state.js"), 'exports.state = () => "v2+v3";\n');
      },
      {},
      { emitsAgentMessageStream: true },
    );

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const aggregatePath = join(
      artifact.artifactDir,
      "context-retrieval-diagnostics.json",
    );
    const stageOnePath = join(
      artifact.artifactDir,
      "stages",
      "upgrade-v2",
      "context-retrieval-diagnostics.json",
    );
    const stageTwoPath = join(
      artifact.artifactDir,
      "stages",
      "upgrade-v3",
      "context-retrieval-diagnostics.json",
    );
    expect(existsSync(stageOnePath)).toBe(true);
    expect(existsSync(stageTwoPath)).toBe(true);
    expect(existsSync(aggregatePath)).toBe(true);
    expect(artifact.contextRetrievalDiagnostics).toMatchObject({
      artifactPath: aggregatePath,
      expectedTargetCount: 2,
      reachedTargetCount: 2,
      missedTargetCount: 0,
      relevantRetrievalBeforeFirstEdit: true,
    });
    expect(artifact.stagedSummary.stages[0]?.contextRetrievalDiagnostics).toMatchObject({
      artifactPath: stageOnePath,
      reachedTargetCount: 1,
    });
    const aggregate = JSON.parse(readFileSync(aggregatePath, "utf-8"));
    expect(aggregate).toMatchObject({
      status: "staged",
      counts: {
        expectedTargetCount: 2,
        reachedTargetCount: 2,
      },
      stages: [
        { stageId: "upgrade-v2" },
        { stageId: "upgrade-v3" },
      ],
    });
  });
});
