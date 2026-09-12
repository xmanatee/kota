import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyAgentPolicyRefusal, classifyAgentRuntimeFailure } from "./step-executor-retry.js";

describe("classifyAgentRuntimeFailure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("classifies typed successful-empty output incidents without parsing text", () => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "antigravity_cli_empty_output",
        message: "",
      }),
    ).toEqual({ kind: "output_contract", retryable: false });
  });

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

  it.each([
    'Agent step "build" failed (codex_cli_error): ',
    'Repair agent for step "improve" failed: ',
  ])("classifies wrapped proxy CONNECT 502 failures: %s", (prefix) => {
    expect(classifyAgentRuntimeFailure({
      message: `${prefix}Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502)`,
    })).toEqual({ kind: "provider", retryable: true });
  });

  it.each([
    { message: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502)" },
    { subtype: "error_during_execution", message: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502)" },
    { subtype: "codex_cli_error", message: "HTTP CONNECT failed with status 502" },
    { subtype: "codex_cli_error", message: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 403)" },
    { subtype: "codex_cli_error", message: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 407)" },
    { subtype: "codex_cli_error", message: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: policy denied)" },
    { subtype: "codex_cli_error", message: "Tool execution failed: permission denied" },
    { subtype: "codex_cli_error", errorName: "AbortError", message: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502)" },
  ])("rejects unrelated or denied proxy failures: $message", (input) => {
    expect(classifyAgentRuntimeFailure(input)).toBeNull();
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

  it.each([
    "Reconnecting... 2/5 (We're currently experiencing high demand, which may cause temporary errors.)",
    "Selected model is at capacity. Please try a different model.",
    'Agent step "build" failed (codex_cli_error): Selected model is at capacity. Please try a different model.',
  ])("classifies Codex CLI high-demand responses as provider failures: %s", (message) => {
    expect(
      classifyAgentRuntimeFailure({
        subtype: "codex_cli_error",
        message,
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("does not treat arbitrary capacity text as a provider response", () => {
    const message = "Selected model is at capacity. Please try a different model.";
    expect(classifyAgentRuntimeFailure({ message })).toBeNull();
    expect(classifyAgentRuntimeFailure({ subtype: "codex_cli_error", message: `Tool result: ${message}` })).toBeNull();
    expect(classifyAgentRuntimeFailure({ subtype: "codex_cli_error", message, errorName: "AbortError" })).toBeNull();
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

  it("honors a relative provider quota reset time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T16:49:25.000Z"));

    expect(
      classifyAgentRuntimeFailure({
        subtype: "antigravity_cli_error",
        message:
          'Agent step "review-evidence" failed (antigravity_cli_error): Individual quota reached. Resets in 1h8m23s.',
      }),
    ).toEqual({
      kind: "rate_limit",
      retryable: false,
      retryAt: "2026-08-04T17:57:48.000Z",
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

describe("classifyAgentRuntimeFailure", () => {
  it("classifies 429 HTTP status as non-retryable rate_limit", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 429 })).toEqual({
      kind: "rate_limit",
      retryable: false,
    });
  });

  it("classifies 401 and 403 HTTP status as non-retryable auth", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 401 })).toEqual({
      kind: "auth",
      retryable: false,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 403 })).toEqual({
      kind: "auth",
      retryable: false,
    });
  });

  it("classifies 5xx and 408 HTTP statuses as retryable provider", () => {
    expect(classifyAgentRuntimeFailure({ message: "", status: 500 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 502 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 503 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 529 })).toEqual({
      kind: "provider",
      retryable: true,
    });
    expect(classifyAgentRuntimeFailure({ message: "", status: 408 })).toEqual({
      kind: "provider",
      retryable: true,
    });
  });

  it("classifies Node network error codes as retryable provider", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EPIPE"]) {
      expect(classifyAgentRuntimeFailure({ message: "", code })).toEqual({
        kind: "provider",
        retryable: true,
      });
    }
  });

  it("parses API Error: <status> from SDK result text", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Claude Code returned an error result: API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({ message: "API Error: 529 overloaded" }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({ message: "API Error: 429" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
  });

  it("classifies rate-limit and auth CLI text markers", () => {
    expect(
      classifyAgentRuntimeFailure({ message: "you've hit your limit for today" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "rate limit exceeded" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "quota exceeded" }),
    ).toEqual({ kind: "rate_limit", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "not logged in" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "please run /login" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({ message: "unauthorized" }),
    ).toEqual({ kind: "auth", retryable: false });
    expect(
      classifyAgentRuntimeFailure({
        message:
          "Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access",
      }),
    ).toEqual({ kind: "auth", retryable: false });
  });

  it("classifies SDK 'Stream idle timeout' as retryable provider", () => {
    expect(
      classifyAgentRuntimeFailure({
        message:
          'Agent step "build" failed (success): API Error: Stream idle timeout - partial response received',
      }),
    ).toEqual({ kind: "provider", retryable: true });
    expect(
      classifyAgentRuntimeFailure({
        message: "API Error: Stream idle timeout",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("classifies SDK connection refusal text as retryable provider", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "API Error: Unable to connect to API (ConnectionRefused)",
      }),
    ).toEqual({ kind: "provider", retryable: true });
  });

  it("does not classify max-turns SDK subtype (step fails hard)", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "Agent exhausted max turns",
        subtype: "error_max_turns",
      }),
    ).toBeNull();
  });

  it("never classifies AbortError (propagated as-is)", () => {
    expect(
      classifyAgentRuntimeFailure({
        message: "aborted",
        errorName: "AbortError",
        code: "ECONNRESET",
      }),
    ).toBeNull();
  });

  it("returns null for unrecognized errors", () => {
    expect(
      classifyAgentRuntimeFailure({ message: "something unexpected happened" }),
    ).toBeNull();
    expect(classifyAgentRuntimeFailure({ message: "" })).toBeNull();
    // Broad fuzzy matches that used to retry no longer do.
    expect(
      classifyAgentRuntimeFailure({ message: "network error occurred" }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({ message: "timed out after 30s" }),
    ).toBeNull();
    expect(
      classifyAgentRuntimeFailure({ message: "internal server error" }),
    ).toBeNull();
  });
});

const policyRefusal = "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. To get authorized for security work, join the Trusted Access for Cyber program: https://chatgpt.com/cyber";

it.each([
  { subtype: "codex_cli_error", message: policyRefusal },
  { message: `Agent step "investigate-candidates" failed (codex_cli_error): ${policyRefusal}` },
])("recognizes provider policy refusal without transient backoff: $message", (input) => {
  expect(classifyAgentPolicyRefusal(input)).toEqual({ kind: "policy-refusal" });
  expect(classifyAgentRuntimeFailure(input)).toBeNull();
});

it.each([
  { message: policyRefusal },
  { subtype: "error_during_execution", message: policyRefusal },
  { subtype: "codex_cli_error", message: `Tool result: ${policyRefusal}` },
  { subtype: "codex_cli_error", message: policyRefusal, errorName: "AbortError" },
  { subtype: "codex_cli_error", message: "HTTP 503 Service Unavailable" },
  { message: "Local permission denied" },
])("does not infer a policy refusal from unrelated failure: $message", (input) => {
  expect(classifyAgentPolicyRefusal(input)).toBeNull();
});
