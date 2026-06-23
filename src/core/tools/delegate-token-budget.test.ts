import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentTokenBudgetLedger,
  TOKEN_BUDGET_EXHAUSTED_SUBTYPE,
} from "#core/agent-harness/index.js";
import type {
  KotaContentBlock,
  KotaMessageStream,
  KotaModelResponse,
} from "#core/agent-harness/message-protocol.js";
import type { ModelClient } from "#core/model/model-client.js";
import { runDelegate, setDelegateConfig } from "./delegate.js";

class TestStream implements KotaMessageStream {
  constructor(private readonly response: KotaModelResponse) {}

  on(_event: "text" | "thinking", _cb: (delta: string) => void): this {
    return this;
  }

  async finalMessage(): Promise<KotaModelResponse> {
    return this.response;
  }
}

function modelResponse(
  content: KotaContentBlock[],
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 1,
    output_tokens: 1,
  },
): KotaModelResponse {
  return {
    id: "msg_delegate",
    role: "assistant",
    model: "test-model",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage,
  };
}

describe("runDelegate token budgets", () => {
  afterEach(() => {
    setDelegateConfig({ model: "gpt-5.5" });
  });

  it("uses a runner-context token budget for child delegate turns", async () => {
    const stream = vi.fn(() =>
      new TestStream(modelResponse([{ type: "text", text: "budgeted child done" }])),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 20 });
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client,
    });

    const result = await runDelegate(
      { task: "Use the workflow budget", mode: "explore" },
      {
        tokenBudget,
        workflow: {
          workflowName: "builder",
          runId: "run-1",
          stepId: "build",
          spanId: "run-1:build",
          scopeId: "scope-1",
          projectId: "scope-1",
        },
      },
    );

    expect(result.is_error).toBeUndefined();
    expect(tokenBudget.snapshot()).toMatchObject({
      budget: { maxTotalTokens: 20 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
  });

  it("returns an error when a final child response exhausts the token budget", async () => {
    const stream = vi.fn(() =>
      new TestStream(
        modelResponse(
          [{ type: "text", text: "over budget answer" }],
          { input_tokens: 1, output_tokens: 1 },
        ),
      ),
    );
    const client: ModelClient = {
      messages: {
        stream,
        create: vi.fn(async () => modelResponse([{ type: "text", text: "unused" }])),
      },
    };
    const tokenBudget = new AgentTokenBudgetLedger({ maxTotalTokens: 1 });
    setDelegateConfig({
      model: "test-model",
      modelOutputTokenLimits: { "test-model": 1234 },
      client,
    });

    const result = await runDelegate(
      { task: "Spend too many tokens", mode: "explore" },
      { tokenBudget },
    );

    expect(result).toMatchObject({ is_error: true });
    expect(result.content).toContain(TOKEN_BUDGET_EXHAUSTED_SUBTYPE);
    expect(result.content).toContain("after model usage was reported");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(tokenBudget.snapshot()).toMatchObject({
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      exhausted: true,
      exhaustedBy: { kind: "delegate-turn", turn: 1 },
    });
  });
});
