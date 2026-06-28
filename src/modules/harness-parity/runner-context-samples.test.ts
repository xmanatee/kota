import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runScenarioAcrossHarnesses } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState, writeContextRetrievalScenario } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner context retrieval sample artifacts", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("captures sample context-retrieval artifacts for clean, missed, late, noisy, and unsupported runs", async () => {
    writeContextRetrievalScenario(scenariosRoot, "context-samples");
    const scenario = loadScenario(scenariosRoot, "context-samples");
    const clean = makeHarness(
      "clean",
      async (workingDir, options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "clean-read",
          toolName: "Read",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "clean-read",
          isError: false,
          content: "add.js contents",
        });
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      { emitsAgentMessageStream: true },
    );
    const missed = makeHarness(
      "missed",
      async (workingDir, options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "missed-read",
          toolName: "Read",
          input: { path: "package.json" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "missed-read",
          isError: false,
          content: "{}",
        });
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      { emitsAgentMessageStream: true },
    );
    const late = makeHarness(
      "late",
      async (workingDir, options) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "late-edit",
          toolName: "Edit",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "late-edit",
          isError: false,
          content: "patched",
        });
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "late-read",
          toolName: "Read",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "late-read",
          isError: false,
          content: "patched contents",
        });
      },
      {},
      { emitsAgentMessageStream: true },
    );
    const noisy = makeHarness(
      "noisy",
      async (workingDir, options) => {
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "noisy-read",
          toolName: "Read",
          input: { path: "package.json" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "noisy-read",
          isError: false,
          content: "{}",
        });
        await options.onMessage?.({
          type: "tool_call",
          toolUseId: "noisy-read-add",
          toolName: "Read",
          input: { path: "add.js" },
        });
        await options.onMessage?.({
          type: "tool_result",
          toolUseId: "noisy-read-add",
          isError: false,
          content: "add.js contents",
        });
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      { emitsAgentMessageStream: true },
    );
    const unsupported = makeHarness("unsupported", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });
    const evidenceRoot =
      process.env.KOTA_HARNESS_PARITY_CONTEXT_EVIDENCE_DIR ?? outRoot;
    if (process.env.KOTA_HARNESS_PARITY_CONTEXT_EVIDENCE_DIR !== undefined) {
      rmSync(evidenceRoot, { recursive: true, force: true });
    }

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [clean, missed, late, noisy, unsupported],
      callOptions: { model: "test-model" },
      outBaseDir: evidenceRoot,
    });

    expect(artifacts).toHaveLength(5);
    expect(artifacts.map((artifact) => artifact.harnessName)).toEqual([
      "clean",
      "missed",
      "late",
      "noisy",
      "unsupported",
    ]);
    for (const artifact of artifacts) {
      expect(
        existsSync(
          join(artifact.artifactDir, "context-retrieval-diagnostics.json"),
        ),
      ).toBe(true);
    }
    expect(artifacts[0]?.contextRetrievalDiagnostics).toMatchObject({
      missedTargetCount: 0,
      relevantRetrievalBeforeFirstEdit: true,
    });
    expect(artifacts[1]?.contextRetrievalDiagnostics).toMatchObject({
      missedTargetCount: 1,
    });
    expect(artifacts[2]?.contextRetrievalDiagnostics).toMatchObject({
      lateRelevantRetrievalActionCount: 1,
      relevantRetrievalBeforeFirstEdit: false,
    });
    expect(artifacts[3]?.contextRetrievalDiagnostics).toMatchObject({
      noisyIrrelevantReadCount: 1,
      missedTargetCount: 0,
    });
    expect(artifacts[4]?.contextRetrievalDiagnostics).toMatchObject({
      status: "unsupported",
      unsupportedTrajectoryState: "harness_does_not_emit_messages",
    });
  });
});
