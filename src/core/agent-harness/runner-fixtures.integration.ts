import { vi } from "vitest";
import type { HarnessHookKind } from "./hooks.js";
import type { AgentHarness } from "./types.js";

export function harnessStub(
  name: string,
  supportedHookKinds: readonly HarnessHookKind[],
): { harness: AgentHarness; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => ({
    text: `${name}-ok`,
    streamedText: `${name}-ok`,
    turns: 1,
    isError: false,
  }));
  return {
    harness: {
      name,
      description: `stub ${name}`,
      supportsMultiTurn: true,
      supportedHookKinds,
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run,
    },
    run,
  };
}
