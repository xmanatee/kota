import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarness } from "#core/agent-harness/types.js";
import { AgentBackoffAdmissionError } from "../agent-backoff.js";
import {
  type AgentBackoffTestFixture,
  createAgentBackoffTestFixture,
} from "../testing/agent-backoff-test-fixture.js";
import { createWorkflowAgentHarnessRunner } from "./workflow-agent-harness-runner.js";

let backoff: AgentBackoffTestFixture;

beforeEach(() => {
  backoff = createAgentBackoffTestFixture();
});

afterEach(() => {
  backoff.dispose();
});

describe("workflow agent harness backoff boundary", () => {
  it("activates on a classified judge failure and denies another launch", async () => {
    let launches = 0;
    const harness: AgentHarness = {
      name: "backoff-boundary-fixture",
      description: "workflow harness backoff fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async () => {
        launches += 1;
        return {
          text: "API Error: 503 provider unavailable",
          streamedText: "",
          turns: 1,
          usage: {
            tokens: { state: "unknown" },
            cost: { state: "unknown" },
          },
          subtype: "error_during_execution",
          isError: true,
        };
      },
    };
    const runner = createWorkflowAgentHarnessRunner(
      undefined,
      backoff.manager,
    );

    await expect(
      runner(harness, { prompt: "critic", effort: "low" }),
    ).rejects.toMatchObject({
      name: "AgentBackoffAdmissionError",
      incidentSignal: { kind: "provider" },
    });
    await expect(
      runner(harness, { prompt: "repair", effort: "low" }),
    ).rejects.toBeInstanceOf(AgentBackoffAdmissionError);
    expect(launches).toBe(1);
  });

  it("returns one typed successful-empty result so the owning caller can retry", async () => {
    let launches = 0;
    const harness: AgentHarness = {
      name: "empty-output-boundary-fixture",
      description: "workflow harness empty-output fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async () => {
        launches += 1;
        return {
          text: "",
          streamedText: "",
          turns: 1,
          usage: {
            tokens: { state: "unknown" },
            cost: { state: "unknown" },
          },
          subtype: "antigravity_cli_empty_output",
          isError: false,
        };
      },
    };
    const runner = createWorkflowAgentHarnessRunner(
      undefined,
      backoff.manager,
    );

    await expect(
      runner(harness, { prompt: "critic", effort: "low" }),
    ).resolves.toMatchObject({
      isError: false,
      subtype: "antigravity_cli_empty_output",
    });
    expect(launches).toBe(1);
  });

  it("lets a mutating repair expose an empty result to workspace checks", async () => {
    const harness: AgentHarness = {
      name: "empty-repair-boundary-fixture",
      description: "workflow harness empty repair fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async () => ({
        text: "",
        streamedText: "",
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        subtype: "antigravity_cli_empty_output",
        isError: false,
      }),
    };
    const runner = createWorkflowAgentHarnessRunner(
      undefined,
      backoff.manager,
    );

    await expect(runner(
      harness,
      { prompt: "repair", effort: "low" },
    )).resolves.toMatchObject({
      isError: false,
      subtype: "antigravity_cli_empty_output",
    });
  });
});
