import { describe, expect, it } from "vitest";
import type { AgentHarness } from "#core/agent-harness/types.js";
import {
  AgentBackoffAdmissionError,
  type AgentBackoffManager,
} from "../agent-backoff.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowAgentIncidentSignal,
} from "../trigger-types.js";
import { createWorkflowAgentHarnessRunner } from "./workflow-agent-harness-runner.js";

function testBackoffGate(): AgentBackoffManager {
  let active: WorkflowAgentBackoffState | null = null;
  const attempts = new Set<AbortController>();
  return {
    registerAttempt(controller: AbortController) {
      if (active !== null) throw new AgentBackoffAdmissionError(active);
      attempts.add(controller);
      return () => attempts.delete(controller);
    },
    apply(signal: WorkflowAgentIncidentSignal) {
      active = {
        runtimeId: "agy:antigravity-cli",
        kind: signal.kind,
        failureCount: 1,
        until: "2026-09-02T18:00:00.000Z",
        updatedAt: "2026-09-02T17:55:00.000Z",
        reason: signal.reason,
      };
      for (const controller of attempts) {
        controller.abort(new AgentBackoffAdmissionError(active));
      }
      attempts.clear();
      return active;
    },
  } as unknown as AgentBackoffManager;
}

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
      testBackoffGate(),
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
      testBackoffGate(),
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
      testBackoffGate(),
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
