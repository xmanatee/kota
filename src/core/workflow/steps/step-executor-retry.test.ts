import { describe, expect, it } from "vitest";
import { classifyAgentRuntimeFailure } from "./step-executor-retry.js";

describe("classifyAgentRuntimeFailure", () => {
  it("classifies native CLI sandbox bootstrap failures as local runtime failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "native_cli_sandbox_error",
        message: "sandbox-exec: sandbox_apply: Operation not permitted",
      }),
    ).toEqual({ kind: "runtime", retryable: false });
  });

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

  it("classifies Codex CLI websocket protocol resets as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          'Agent step "build" failed (codex_cli_error): Reconnecting... 2/2 (stream disconnected before completion: WebSocket protocol error: Connection reset without closing handshake)',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI peer-reset stream disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          "Reconnecting... 2/5 (stream disconnected before completion: IO error: Connection reset by peer (os error 54))",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI response-body decode disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Repair agent for step "build" failed: Reconnecting... 1/5 (stream disconnected before completion: Transport error: network error: error decoding response body)',
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

  it("classifies Codex CLI provider-request stream disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Repair agent for step "build" failed: Reconnecting... 3/5 (stream disconnected before completion: An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID 6f4976f7-b5bf-4269-9083-c9b468c32233 in your message.)',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI reconnect request timeouts as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message: "Reconnecting... 2/5 (request timed out)",
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Repair agent for step "build" failed: Reconnecting... 2/5 (request timed out)',
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

  it("classifies Codex CLI HTTP 503 responses as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          "unexpected status 503 Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: a20a34385ba9b235-LHR, auth error: 503, auth error code: biscuit_baker_service_me_circuit_open",
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Repair agent for step "improve" failed: unexpected status 503 Service Unavailable: Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses, cf-ray: a20a34385ba9b235-LHR',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI internal-server stream disconnects as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          "Reconnecting... 2/5 (stream disconnected before completion: Internal server error)",
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Repair agent for step "build" failed: Reconnecting... 2/5 (stream disconnected before completion: Internal server error)',
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies Codex CLI high-demand responses as provider failures", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message:
          "Reconnecting... 2/5 (We're currently experiencing high demand, which may cause temporary errors.)",
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
    ).toEqual({
      kind: "rate_limit",
      retryable: false,
      retryAt: new Date("Jun 1, 2026 1:01 AM").toISOString(),
    });
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
    expect(
      classifyAgentRuntimeFailure({
        message:
          "unexpected status 503 Service Unavailable, url: https://chatgpt.com/backend-api/codex/responses",
      }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({
        message:
          "Reconnecting... 2/5 (stream disconnected before completion: Internal server error)",
      }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({
        message:
          "Reconnecting... 2/5 (We're currently experiencing high demand, which may cause temporary errors.)",
      }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({
        message:
          "stream disconnected before completion: IO error: Connection reset by peer (os error 54)",
      }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({
        message:
          "stream disconnected before completion: Transport error: network error: error decoding response body",
      }),
    ).toBeNull();
  });
});
