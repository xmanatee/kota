import { describe, expect, it, vi } from "vitest";
import {
  buildKotaAgentCommandTrace,
  kotaAgentCommandTraceMatches,
} from "#core/agent-harness/index.js";
import { collectAntigravityOutput } from "./cli-output.js";

async function* outputLines(): AsyncIterable<string> {
  yield JSON.stringify({
    event: "step_update",
    step_update: {
      conversation_id: "conversation-tool-trace",
      step_index: 2,
      step_type: "tool",
      state: "SUCCESS",
      tool_name: "run_command",
      tool_info: {
        name: "run_command",
        parameters: {
          command: "pnpm run test",
          content: "non-command tool input stays out of status output",
        },
      },
    },
  });
  yield JSON.stringify({
    event: "result",
    result: {
      conversation_id: "conversation-tool-trace",
      status: "SUCCESS",
      response: "done",
    },
  });
}

describe("Antigravity CLI command trace", () => {
  it("emits safe command fingerprints instead of provider tool input", async () => {
    const onMessage = vi.fn();
    await collectAntigravityOutput({
      lines: outputLines(),
      writer: undefined,
      onMessage,
    });

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "status",
        category: "tool",
        toolName: "run_command",
        commandTrace: buildKotaAgentCommandTrace("pnpm run test"),
      }),
    );
    const status = onMessage.mock.calls[0]?.[0];
    expect(status).not.toHaveProperty("output");
    expect(JSON.stringify(status)).not.toContain("pnpm run test");
    expect(
      kotaAgentCommandTraceMatches(status.commandTrace, "pnpm run test", "exact"),
    ).toBe(true);
  });
});
