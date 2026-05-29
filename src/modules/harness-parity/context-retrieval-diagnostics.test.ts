import { describe, expect, it } from "vitest";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import { buildContextRetrievalDiagnosticsArtifact } from "./context-retrieval-diagnostics.js";
import type { ScenarioContextRetrievalSpec } from "./scenario.js";

const streamingCapability = { emitsAgentMessageStream: true };
const nonStreamingCapability = { emitsAgentMessageStream: false };

const addExpectation: ScenarioContextRetrievalSpec = {
  targets: [{ id: "adder", kind: "path", path: "add.js" }],
};

function toolCall(
  index: number,
  toolName: string,
  input: Extract<KotaAgentMessage, { type: "tool_call" }>["input"],
): KotaAgentMessage {
  return {
    type: "tool_call",
    toolUseId: `tool-${index}`,
    toolName,
    input,
  };
}

function toolResult(
  index: number,
  content = "ok",
  isError = false,
): KotaAgentMessage {
  return {
    type: "tool_result",
    toolUseId: `tool-${index}`,
    isError,
    content,
  };
}

function diagnosticsFor(messages: readonly KotaAgentMessage[]) {
  return buildContextRetrievalDiagnosticsArtifact({
    capability: streamingCapability,
    messages,
    expectation: addExpectation,
  });
}

function warningCodes(messages: readonly KotaAgentMessage[]) {
  return diagnosticsFor(messages).warnings.map((warning) => warning.code);
}

describe("context retrieval diagnostics", () => {
  it("records clean pre-edit discovery of an expected file", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Read", { path: "add.js" }),
      toolResult(1, "exports.add = (a, b) => a - b;"),
      toolCall(2, "Edit", { path: "add.js" }),
      toolResult(2),
    ]);

    expect(artifact.status).toBe("supported");
    expect(artifact.firstRelevantRetrievalFrame).toBe(0);
    expect(artifact.firstImplementationEditFrame).toBe(2);
    expect(artifact.relevantRetrievalBeforeFirstEdit).toBe(true);
    expect(artifact.missedTargets).toEqual([]);
    expect(artifact.noisyIrrelevantReadCount).toBe(0);
    expect(artifact.counts).toMatchObject({
      expectedTargetCount: 1,
      reachedTargetCount: 1,
      missedTargetCount: 0,
      retrievalActionCount: 1,
      relevantRetrievalActionCount: 1,
      preEditRelevantRetrievalActionCount: 1,
      warningCount: 0,
    });
    expect(artifact.expectedTargets[0]).toMatchObject({
      id: "adder",
      reached: true,
      reachedBeforeFirstEdit: true,
      firstReachedFrame: 0,
      matchClass: "path",
    });
    expect(artifact.observedRetrievalActions[0]).toMatchObject({
      frameIndex: 0,
      toolName: "Read",
      category: "read_file",
      matchedTargetIds: ["adder"],
      matchSource: "input",
      beforeFirstEdit: true,
    });
  });

  it("matches expected files through search result content without storing raw results", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Grep", { pattern: "subtract" }),
      toolResult(1, "add.js:1:exports.add = (a, b) => a - b;"),
      toolCall(2, "Edit", { path: "add.js" }),
      toolResult(2),
    ]);

    expect(artifact.relevantRetrievalBeforeFirstEdit).toBe(true);
    expect(artifact.observedRetrievalActions[0]).toMatchObject({
      category: "search",
      matchedTargetIds: ["adder"],
      matchSource: "result",
    });
  });

  it("warns when expected targets are missed", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Read", { path: "package.json" }),
      toolResult(1, "{}"),
      toolCall(2, "Edit", { path: "add.js" }),
      toolResult(2),
    ]);

    expect(artifact.missedTargets).toEqual(["adder"]);
    expect(artifact.relevantRetrievalBeforeFirstEdit).toBe(false);
    expect(artifact.counts.missedTargetCount).toBe(1);
    expect(warningCodes([
      toolCall(1, "Read", { path: "package.json" }),
      toolResult(1, "{}"),
      toolCall(2, "Edit", { path: "add.js" }),
      toolResult(2),
    ])).toContain("missed_retrieval_target");
  });

  it("warns when relevant files are read only after implementation starts", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Edit", { path: "add.js" }),
      toolResult(1),
      toolCall(2, "Read", { path: "add.js" }),
      toolResult(2),
    ]);

    expect(artifact.firstImplementationEditFrame).toBe(0);
    expect(artifact.firstRelevantRetrievalFrame).toBe(2);
    expect(artifact.relevantRetrievalBeforeFirstEdit).toBe(false);
    expect(artifact.expectedTargets[0]).toMatchObject({
      reached: true,
      reachedBeforeFirstEdit: false,
    });
    expect(artifact.warnings.map((warning) => warning.code)).toContain(
      "relevant_retrieval_after_first_edit",
    );
  });

  it("counts noisy irrelevant reads separately from useful discovery", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Read", { path: "package.json" }),
      toolResult(1, "{}"),
      toolCall(2, "Read", { path: "add.js" }),
      toolResult(2),
      toolCall(3, "Edit", { path: "add.js" }),
      toolResult(3),
    ]);

    expect(artifact.missedTargets).toEqual([]);
    expect(artifact.noisyIrrelevantReadCount).toBe(1);
    expect(artifact.counts.noisyIrrelevantReadCount).toBe(1);
    expect(artifact.warnings.map((warning) => warning.code)).toContain(
      "noisy_irrelevant_reads",
    );
  });

  it("matches glob targets against discovered path candidates", () => {
    const artifact = buildContextRetrievalDiagnosticsArtifact({
      capability: streamingCapability,
      messages: [
        toolCall(1, "Grep", { pattern: "normalize" }),
        toolResult(1, "/tmp/work/src/normalize.js:1:function normalize() {}"),
      ],
      expectation: {
        targets: [{ id: "source-files", kind: "glob", glob: "src/*.js" }],
      },
    });

    expect(artifact.expectedTargets[0]).toMatchObject({
      id: "source-files",
      reached: true,
      matchClass: "glob",
    });
    expect(artifact.observedRetrievalActions[0]?.matchSource).toBe("result");
  });

  it("warns on adapter-specific raw frames while preserving supported diagnostics", () => {
    const artifact = diagnosticsFor([
      {
        type: "raw",
        adapter: "fake",
        payload: { event: "provider-specific" },
      },
      toolCall(1, "Read", { path: "add.js" }),
      toolResult(1),
    ]);

    expect(artifact.status).toBe("supported");
    expect(artifact.unsupportedTrajectoryState).toMatchObject({
      kind: "raw_frames_present",
      rawFrameCount: 1,
    });
    expect(artifact.counts.unsupportedTrajectoryFrameCount).toBe(1);
    expect(artifact.warnings.map((warning) => warning.code)).toContain(
      "unsupported_trajectory_frames",
    );
  });

  it("records unsupported diagnostics for non-streaming harnesses", () => {
    const artifact = buildContextRetrievalDiagnosticsArtifact({
      capability: nonStreamingCapability,
      messages: [],
      expectation: addExpectation,
    });

    expect(artifact).toMatchObject({
      status: "unsupported",
      emitsAgentMessageStream: false,
      relevantRetrievalBeforeFirstEdit: false,
      missedTargets: ["adder"],
      unsupportedTrajectoryState: {
        kind: "harness_does_not_emit_messages",
      },
      counts: {
        expectedTargetCount: 1,
        missedTargetCount: 1,
        warningCount: 1,
      },
    });
    expect(artifact.warnings[0]?.code).toBe("unsupported_trajectory");
  });
});
