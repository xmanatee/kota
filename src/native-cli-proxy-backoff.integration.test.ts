import { expect, it } from "vitest";
import {
  createRunExecutorTestFixture,
  makeAgentStep,
  makeDefinition,
  registerWorkflowScenarioDriver,
} from "#core/workflow/run-executor-test-fixture.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import { createAgentBackoffTestFixture } from "#core/workflow/testing/agent-backoff-test-fixture.js";
import { deadLetterHealthCategory } from "#modules/autonomy/dead-letter-health.js";

it("parks Codex proxy CONNECT 502 failures and attributes them to an external service", async () => {
  const fixture = createRunExecutorTestFixture();
  const backoff = createAgentBackoffTestFixture();
  const harness = "workflow-codex-proxy-connect-failure";
  const failure = {
    text: "Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 502)",
    subtype: "codex_cli_error",
  };
  let attempts = 0;
  registerWorkflowScenarioDriver(harness, async () => {
    attempts += 1;
    return {
      ...failure,
      streamedText: "",
      turns: 1,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
      isError: true,
    };
  });
  const definition = makeDefinition({
    moduleRoot: fixture.workspaceRoot,
    steps: [makeAgentStep(fixture.workspaceRoot, harness, {
      retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
    })],
  });

  try {
    expect(classifyAgentRuntimeFailure({
      message: failure.text,
      subtype: failure.subtype,
    })).toEqual({ kind: "provider", retryable: true });
    const result = await fixture.execute(definition, {
      agentBackoff: backoff.manager,
    }).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(result.agentBackoff?.reason).toContain(failure.text);
    expect(backoff.state.getAgentBackoff()).toMatchObject({ kind: "provider" });
    expect(attempts).toBe(1);
    expect(deadLetterHealthCategory({
      lastErrorClass: "execution",
      reason: result.agentBackoff?.reason ?? "",
    })).toMatchObject({
      failureClass: "provider",
      actionability: "external-service",
    });
  } finally {
    backoff.dispose();
    fixture.dispose();
  }
});
