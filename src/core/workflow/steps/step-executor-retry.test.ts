import { describe, expect, it } from "vitest";
import { classifyAgentRuntimeFailure } from "./step-executor-retry.js";

describe("classifyAgentRuntimeFailure", () => {
  it("classifies Codex CLI websocket stream disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          'Repair agent for step "improve" failed: Reconnecting... 2/5 (stream disconnected before completion: idle timeout sending websocket request)',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI websocket wait timeouts as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          'Agent step "build" failed (codex_cli_error): Reconnecting... 2/5 (stream disconnected before completion: idle timeout waiting for websocket)',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI remote compact disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          "Error running remote compact task: stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses/compact)",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI response stream disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("does not classify arbitrary request-disconnect text as a provider failure", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          "stream disconnected before completion: error sending request for url (https://example.test/internal)",
      }),
    ).toBeNull();
  });
});
