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

  it("classifies Codex CLI DNS lookup stream disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Repair agent for step "build" failed: Reconnecting... 5/5 (stream disconnected before completion: failed to lookup address information: nodename nor servname provided, or not known)',
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

  it("classifies no-detail Codex CLI exits as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          'Agent step "explore" failed (codex_cli_error): Codex CLI exited with code 1',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI usage-limit text as a rate-limit failure", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          'Agent step "build" failed (codex_cli_error): You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jun 1st, 2026 1:01 AM.',
      }),
    ).toEqual({ kind: "rate_limit", retryable: false });
  });

  it("classifies harness readiness failures as operator setup/auth failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "harness_readiness",
        message:
          'Agent step "improve" failed (harness_readiness): Required agent harness "codex" readiness failed: localRuntime missing: codex executable not found on PATH',
      }),
    ).toEqual({ kind: "auth", retryable: false });
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
