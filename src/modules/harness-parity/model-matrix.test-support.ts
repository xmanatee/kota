import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentHarness,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";

export const FIX_ADD_SCENARIO_ID = "fix-add";

export function writeFixAddScenario(scenariosRoot: string): void {
  const dir = join(scenariosRoot, FIX_ADD_SCENARIO_ID);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id: FIX_ADD_SCENARIO_ID,
      description: "fix add",
      prompt: "fix add",
      verification: {
        command:
          "node -e \"require('./add.js').add(2,3)===5 || process.exit(1)\"",
        timeoutMs: 10_000,
      },
    }),
  );
  writeFileSync(
    join(dir, "initial", "add.js"),
    "exports.add = (a, b) => a - b;\n",
  );
}

export function createFixingHarness(name: string): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"] as const,
    askOwnerToolName: null,
    emitsAgentMessageStream: true,
    toolControl: "kota",
    async run(options: AgentHarnessRunOptions) {
      writeFileSync(
        join(options.cwd ?? process.cwd(), "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
      options.onMessage?.({
        type: "tool_call",
        toolUseId: "tool-1",
        toolName: "edit",
        input: { path: "add.js" },
      });
      options.onMessage?.({
        type: "tool_result",
        toolUseId: "tool-1",
        isError: false,
        content: "ok",
      });
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
        inputTokens: 10,
        outputTokens: 5,
        totalCostUsd: 0.002,
      };
    },
  };
}
