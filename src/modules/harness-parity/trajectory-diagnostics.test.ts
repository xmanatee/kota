import { describe, expect, it } from "vitest";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import { buildTrajectoryDiagnosticsArtifact } from "./trajectory-diagnostics.js";

const streamingCapability = { emitsAgentMessageStream: true };
const nonStreamingCapability = { emitsAgentMessageStream: false };

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

function toolResult(index: number, isError: boolean): KotaAgentMessage {
  return {
    type: "tool_result",
    toolUseId: `tool-${index}`,
    isError,
    content: isError ? "failed" : "ok",
  };
}

function diagnosticsFor(messages: readonly KotaAgentMessage[]) {
  return buildTrajectoryDiagnosticsArtifact({
    capability: streamingCapability,
    messages,
    changedFiles: ["add.js"],
    verificationCommand: "node test.js",
  });
}

function diagnosticCodes(messages: readonly KotaAgentMessage[]) {
  return diagnosticsFor(messages).diagnostics.map((diagnostic) => diagnostic.code);
}

describe("trajectory diagnostics", () => {
  it("does not warn for a clean edit-then-verify trajectory", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Edit", { path: "add.js" }),
      toolResult(1, false),
      toolCall(2, "Bash", { command: "pnpm test add.test.ts" }),
      toolResult(2, false),
    ]);

    expect(artifact.counts.warningCount).toBe(0);
    expect(artifact.diagnostics).toEqual([]);
  });

  it("treats the declared scenario verifier as verification-like", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Edit", { path: "add.js" }),
      toolResult(1, false),
      toolCall(2, "Bash", { command: "node test.js" }),
      toolResult(2, false),
    ]);

    expect(artifact.counts.warningCount).toBe(0);
  });

  it("warns when an edit has no later verification-like command", () => {
    const codes = diagnosticCodes([
      toolCall(1, "Edit", { path: "add.js" }),
      toolResult(1, false),
    ]);

    expect(codes).toContain("missing_final_verification_after_edit");
  });

  it("warns on repeated identical failing commands without an intervening edit", () => {
    const artifact = diagnosticsFor([
      toolCall(1, "Bash", { command: "pnpm test add.test.ts" }),
      toolResult(1, true),
      toolCall(2, "Bash", { command: "pnpm   test   add.test.ts" }),
      toolResult(2, true),
    ]);

    expect(artifact.counts.repeatedIdenticalFailingCommandCount).toBe(1);
    expect(artifact.diagnostics[0]?.frameIndexes).toEqual([0, 1, 2, 3]);
  });

  it("warns when a successful verification is followed by another edit", () => {
    const codes = diagnosticCodes([
      toolCall(1, "Bash", { command: "pnpm test add.test.ts" }),
      toolResult(1, false),
      toolCall(2, "Edit", { path: "add.js" }),
      toolResult(2, false),
    ]);

    expect(codes).toContain("edit_after_successful_verification");
    expect(codes).toContain("missing_final_verification_after_edit");
  });

  it("warns when a streaming-capable harness emits no frames", () => {
    const artifact = buildTrajectoryDiagnosticsArtifact({
      capability: streamingCapability,
      messages: [],
      changedFiles: ["add.js"],
      verificationCommand: "node test.js",
    });

    expect(artifact.counts.missingStreamingFramesCount).toBe(1);
    expect(artifact.diagnostics[0]?.code).toBe("missing_streaming_frames");
  });

  it("warns on long pre-implementation tool use without touching changed files", () => {
    const codes = diagnosticCodes([
      toolCall(1, "Read", { path: "notes.md" }),
      toolResult(1, false),
      toolCall(2, "Read", { path: "package.json" }),
      toolResult(2, false),
      toolCall(3, "Read", { path: "README.md" }),
      toolResult(3, false),
      toolCall(4, "Read", { path: "docs/intro.md" }),
      toolResult(4, false),
      toolCall(5, "Read", { path: "src/other.ts" }),
      toolResult(5, false),
      toolCall(6, "Read", { path: "src/unrelated.ts" }),
      toolResult(6, false),
      toolCall(7, "Edit", { path: "add.js" }),
      toolResult(7, false),
      toolCall(8, "Bash", { command: "pnpm test add.test.ts" }),
      toolResult(8, false),
    ]);

    expect(codes).toContain("long_preamble_without_task_touch");
  });

  it("records unsupported diagnostics for non-streaming harnesses", () => {
    const artifact = buildTrajectoryDiagnosticsArtifact({
      capability: nonStreamingCapability,
      messages: [],
      changedFiles: ["add.js"],
      verificationCommand: "node test.js",
    });

    expect(artifact.status).toBe("unsupported");
    expect(artifact.counts.unsupportedTrajectoryCount).toBe(1);
  });
});
