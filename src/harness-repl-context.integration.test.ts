import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import type { ReplChrome } from "#core/modules/provider-types.js";
import { runHarnessRepl } from "#modules/repl/index.js";

function makeInput(lines: string[]): Readable {
  return Readable.from(lines.map((line) => `${line}\n`));
}

class CapturingChrome implements ReplChrome {
  readonly announcements: Array<{
    harness: { name: string; description: string };
    model: string;
  }> = [];

  announceHarness(
    harness: { name: string; description: string },
    model: string,
  ): void {
    this.announcements.push({ harness, model });
  }
  showHelp(): void {}
  showStatus(): void {}
  showReset(): void {}
  showError(): void {}
  showGoodbye(): void {}
}

const output = { write: (_text: string) => true };

describe("runHarnessRepl context", () => {
  it("rejects harnesses that do not support multi-turn", async () => {
    const singleTurnHarness: AgentHarness = {
      name: "one-shot",
      description: "single-turn only",
      supportsMultiTurn: false,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (): Promise<AgentHarnessResult> => ({
        text: "",
        streamedText: "",
        turns: 0,
        usage: UNKNOWN_AGENT_USAGE,
        isError: false,
      }),
    };

    await expect(
      runHarnessRepl({
        harness: singleTurnHarness,
        model: "irrelevant",
        cwd: process.cwd(),
        run: { effort: "xhigh" },
        input: makeInput(["hi", "exit"]),
        chrome: new CapturingChrome(),
        output,
      }),
    ).rejects.toThrow(/one-shot.*does not support multi-turn/);
  });

  it("announces the harness and routes canonical and execution directories", async () => {
    const captured: AgentHarnessRunOptions[] = [];
    const harness: AgentHarness = {
      name: "stub",
      description: "stub for banner test",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: async (options): Promise<AgentHarnessResult> => {
        captured.push(options);
        return {
          text: "ok",
          streamedText: "ok",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      },
    };

    const chrome = new CapturingChrome();
    await runHarnessRepl({
      harness,
      model: "test-model-x",
      cwd: process.cwd(),
      run: { effort: "xhigh" },
      input: makeInput(["hi", "exit"]),
      chrome,
      output,
    });

    expect(chrome.announcements[0]).toMatchObject({
      harness: { name: "stub" },
      model: "test-model-x",
    });
    expect(captured[0]).toMatchObject({
      scopeRoot: process.cwd(),
      cwd: process.cwd(),
    });
  });
});
