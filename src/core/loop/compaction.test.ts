import { describe, expect, it, vi } from "vitest";
import type { KotaMessage } from "#core/agent-harness/message-protocol.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
import { compactMessages, extractWorkingState } from "./compaction.js";

type Message = KotaMessage;

function mockCompactionClient(summary: string): {
  client: ModelClient;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: summary }],
  });
  return {
    client: { messages: { create } } as unknown as ModelClient,
    create,
  };
}

function compactionPromptFrom(create: ReturnType<typeof vi.fn>, callIndex = 0): string {
  const params = create.mock.calls[callIndex]?.[0] as MessageCreateParams | undefined;
  const prompt = params?.messages[0]?.content;
  expect(typeof prompt).toBe("string");
  return prompt as string;
}

function toolUse(name: string, input: Record<string, unknown>, id = "t1"): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  };
}

function toolResult(content: string, id = "t1", is_error = false): Message {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content, is_error }],
  };
}

describe("extractWorkingState", () => {
  it("returns empty state for no messages", () => {
    const state = extractWorkingState([]);
    expect(state.filesModified).toEqual([]);
    expect(state.commandsRun).toEqual([]);
    expect(state.errors).toEqual([]);
    expect(state.toolCalls).toBe(0);
  });

  it("ignores string-content messages", () => {
    const state = extractWorkingState([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    expect(state.toolCalls).toBe(0);
  });

  it("extracts file_edit paths", () => {
    const state = extractWorkingState([
      toolUse("file_edit", { file_path: "src/foo.ts", old_string: "a", new_string: "b" }),
    ]);
    expect(state.filesModified).toEqual(["src/foo.ts"]);
    expect(state.toolCalls).toBe(1);
  });

  it("extracts file_write paths", () => {
    const state = extractWorkingState([
      toolUse("file_write", { path: "src/new.ts", content: "hello" }),
    ]);
    expect(state.filesModified).toEqual(["src/new.ts"]);
  });

  it("deduplicates files", () => {
    const state = extractWorkingState([
      toolUse("file_edit", { file_path: "a.ts" }, "t1"),
      toolUse("file_edit", { file_path: "a.ts" }, "t2"),
      toolUse("file_edit", { file_path: "b.ts" }, "t3"),
    ]);
    expect(state.filesModified).toEqual(["a.ts", "b.ts"]);
    expect(state.toolCalls).toBe(3);
  });

  it("extracts multi_edit file paths", () => {
    const state = extractWorkingState([
      toolUse("multi_edit", {
        edits: [{ file_path: "x.ts" }, { file_path: "y.ts" }, { file_path: "x.ts" }],
      }),
    ]);
    expect(state.filesModified).toEqual(["x.ts", "y.ts"]);
  });

  it("extracts shell commands", () => {
    const state = extractWorkingState([
      toolUse("shell", { command: "npm test" }, "t1"),
      toolUse("shell", { command: "npm run build" }, "t2"),
    ]);
    expect(state.commandsRun).toEqual(["npm test", "npm run build"]);
  });

  it("extracts process start commands with [bg] prefix", () => {
    const state = extractWorkingState([
      toolUse("process", { action: "start", command: "npm test" }, "t1"),
      toolUse("shell", { command: "npm run build" }, "t2"),
    ]);
    expect(state.commandsRun).toEqual(["[bg] npm test", "npm run build"]);
  });

  it("ignores process output/signal/list actions", () => {
    const state = extractWorkingState([
      toolUse("process", { action: "output", process_id: "p1" }, "t1"),
      toolUse("process", { action: "signal", process_id: "p1", signal: "SIGTERM" }, "t2"),
      toolUse("process", { action: "list" }, "t3"),
    ]);
    expect(state.commandsRun).toEqual([]);
  });

  it("deduplicates shell commands", () => {
    const state = extractWorkingState([
      toolUse("shell", { command: "npm test" }, "t1"),
      toolUse("shell", { command: "npm test" }, "t2"),
    ]);
    expect(state.commandsRun).toEqual(["npm test"]);
  });

  it("truncates long commands to 120 chars", () => {
    const longCmd = "x".repeat(200);
    const state = extractWorkingState([toolUse("shell", { command: longCmd })]);
    expect(state.commandsRun[0].length).toBe(123); // 120 + "..."
    expect(state.commandsRun[0].endsWith("...")).toBe(true);
  });

  it("keeps last 15 commands", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(toolUse("shell", { command: `cmd-${i}` }, `t${i}`));
    }
    const state = extractWorkingState(messages);
    expect(state.commandsRun.length).toBe(15);
    expect(state.commandsRun[0]).toBe("cmd-5");
    expect(state.commandsRun[14]).toBe("cmd-19");
  });

  it("extracts errors from tool_result with is_error", () => {
    const state = extractWorkingState([
      toolResult("File not found: foo.ts", "t1", true),
      toolResult("Success", "t2", false),
    ]);
    expect(state.errors).toEqual(["File not found: foo.ts"]);
  });

  it("truncates long errors to 200 chars", () => {
    const longErr = "e".repeat(300);
    const state = extractWorkingState([toolResult(longErr, "t1", true)]);
    expect(state.errors[0].length).toBe(203); // 200 + "..."
  });

  it("keeps last 5 errors", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 8; i++) {
      messages.push(toolResult(`error-${i}`, `t${i}`, true));
    }
    const state = extractWorkingState(messages);
    expect(state.errors.length).toBe(5);
    expect(state.errors[0]).toBe("error-3");
    expect(state.errors[4]).toBe("error-7");
  });

  it("handles mixed message types in a real conversation", () => {
    const messages: Message[] = [
      { role: "user", content: "Fix the auth module" },
      toolUse("file_read", { file_path: "src/auth.ts" }, "t1"),
      toolResult("export function login() { ... }", "t1"),
      toolUse("file_edit", { file_path: "src/auth.ts" }, "t2"),
      toolResult("Edit applied", "t2"),
      toolUse("shell", { command: "npm test" }, "t3"),
      toolResult("Tests failed: 2 errors", "t3", true),
      toolUse("file_edit", { file_path: "src/auth.ts" }, "t4"),
      toolResult("Edit applied", "t4"),
      toolUse("shell", { command: "npm test" }, "t5"),
      toolResult("All tests pass", "t5"),
    ];
    const state = extractWorkingState(messages);
    expect(state.filesModified).toEqual(["src/auth.ts"]);
    expect(state.commandsRun).toEqual(["npm test"]);
    expect(state.errors).toEqual(["Tests failed: 2 errors"]);
    expect(state.toolCalls).toBe(5); // file_read + 2 file_edit + 2 shell
  });
});

describe("compactMessages assistant thinking preservation", () => {
  it("includes mixed assistant thinking, text, and tool use in compaction context", async () => {
    const planToken = "PLAN-MIXED-THINKING-TOKEN";
    const signature = "provider-signature-mixed";
    const { client, create } = mockCompactionClient(
      `Kept ${planToken}: inspect config before editing, then rerun tests.`,
    );
    const messages: Message[] = [
      { role: "user", content: "Fix the config loader regression" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: `${planToken}: inspect the config loader first, then edit only the failing branch.`,
            signature,
          },
          { type: "text", text: "Inspecting the config loader before editing." },
          { type: "tool_use", id: "read-config", name: "file_read", input: { path: "src/core/config/config.ts" } },
        ],
      },
    ];

    const compacted = await compactMessages(client, "claude-sonnet", messages, 1);
    const prompt = compactionPromptFrom(create);
    const compactedText = compacted[0].content as string;

    expect(prompt).toContain("[assistant thinking/rationale]");
    expect(prompt).toContain(planToken);
    expect(prompt).toContain("Inspecting the config loader");
    expect(prompt).toContain("file_read");
    expect(prompt).not.toContain(signature);
    expect(compactedText).toContain("Assistant rationale");
    expect(compactedText).toContain(planToken);
    expect(compactedText).not.toContain(signature);
  });

  it("bounds long thinking blocks before they reach the compaction prompt", async () => {
    const planToken = "PLAN-LONG-THINKING-TOKEN";
    const omittedTail = "LONG-THINKING-TAIL-MUST-NOT-APPEAR";
    const { client, create } = mockCompactionClient(`Kept ${planToken}.`);
    const messages: Message[] = [
      { role: "user", content: "Continue the long-running refactor" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: `${planToken}: preserve this active plan. ${"x".repeat(900)} ${omittedTail}`,
            signature: "provider-signature-long",
          },
          { type: "text", text: "Continuing the refactor." },
        ],
      },
    ];

    const compacted = await compactMessages(client, "claude-sonnet", messages, 1);
    const prompt = compactionPromptFrom(create);
    const compactedText = compacted[0].content as string;

    expect(prompt).toContain(planToken);
    expect(prompt).toContain("[truncated]");
    expect(prompt).not.toContain(omittedTail);
    expect(compactedText).toContain(planToken);
    expect(compactedText).toContain("[truncated]");
    expect(compactedText).not.toContain(omittedTail);
  });

  it("bounds total thinking blocks before they reach the compaction prompt", async () => {
    const oldPlanToken = "PLAN-OLD-THINKING-TOKEN";
    const retainedStartToken = "PLAN-RETAINED-START-TOKEN";
    const retainedEndToken = "PLAN-RETAINED-END-TOKEN";
    const { client, create } = mockCompactionClient(`Kept ${retainedStartToken} through ${retainedEndToken}.`);
    const messages: Message[] = [
      { role: "user", content: "Continue the multi-step repair" },
      ...Array.from({ length: 8 }, (_, index): Message => ({
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking:
              index === 0
                ? `${oldPlanToken}: superseded investigation notes.`
                : index === 2
                  ? `${retainedStartToken}: first rationale inside the bounded window.`
                  : index === 7
                    ? `${retainedEndToken}: latest rationale inside the bounded window.`
                    : `PLAN-MIDDLE-${index}: bounded rationale item.`,
            signature: `provider-signature-${index}`,
          },
        ],
      })),
    ];

    const compacted = await compactMessages(client, "claude-sonnet", messages, 1);
    const prompt = compactionPromptFrom(create);
    const compactedText = compacted[0].content as string;

    expect(prompt).not.toContain(oldPlanToken);
    expect(prompt).toContain(retainedStartToken);
    expect(prompt).toContain(retainedEndToken);
    expect(prompt.match(/\[assistant thinking\/rationale\]/g)).toHaveLength(6);
    expect(compactedText).not.toContain(oldPlanToken);
    expect(compactedText).toContain(retainedStartToken);
    expect(compactedText).toContain(retainedEndToken);
  });

  it("omits thinking signatures from the prompt and redacts them from compacted output", async () => {
    const planToken = "PLAN-SIGNATURE-OMISSION-TOKEN";
    const signature = "provider-signature-secret-123";
    const { client, create } = mockCompactionClient(
      `Summary kept ${planToken} and must not expose ${signature}.`,
    );
    const messages: Message[] = [
      { role: "user", content: "Keep going after compaction" },
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: `${planToken}: validate the change before moving the task.`,
            signature,
          },
        ],
      },
    ];

    const compacted = await compactMessages(client, "claude-sonnet", messages, 1);
    const prompt = compactionPromptFrom(create);
    const compactedText = compacted[0].content as string;

    expect(prompt).toContain(planToken);
    expect(prompt).not.toContain(signature);
    expect(compactedText).toContain(planToken);
    expect(compactedText).toContain("[redacted thinking signature]");
    expect(compactedText).not.toContain(signature);
  });

  it("preserves thinking-derived rationale through repeated compaction", async () => {
    const planToken = "PLAN-REPEATED-COMPACTION-TOKEN";
    const signature = "provider-signature-repeat";
    const create = vi.fn().mockImplementation((params: MessageCreateParams) => {
      const prompt = params.messages[0]?.content;
      const promptText = typeof prompt === "string" ? prompt : "";
      return Promise.resolve({
        content: [{
          type: "text",
          text: promptText.includes(planToken)
            ? `Repeated compaction retained ${planToken}: inspect, patch, then run focused tests.`
            : "Summary without thinking rationale.",
        }],
      });
    });
    const client = { messages: { create } } as unknown as ModelClient;
    const noisyWorkingState = Array.from({ length: 70 }, (_, index) =>
      toolUse("file_edit", { file_path: `src/generated/repeated-compaction-noise-${index}.ts` }, `edit-${index}`),
    );
    const firstPassMessages: Message[] = [
      { role: "user", content: "Patch compaction behavior" },
      ...noisyWorkingState,
      {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: `${planToken}: preserve why the compaction path is being changed.`,
            signature,
          },
          { type: "text", text: "Updating the compaction path." },
        ],
      },
    ];

    const compacted1 = await compactMessages(client, "claude-sonnet", firstPassMessages, 1);
    const compactedText1 = compacted1[0].content as string;
    expect(compactedText1.slice(0, 800)).not.toContain(planToken);
    expect(compactedText1).toContain(planToken);
    expect(compactedText1).not.toContain(signature);

    const secondPassMessages: Message[] = [
      ...compacted1,
      { role: "user", content: "Continue from the compacted context" },
      { role: "assistant", content: "Continuing from the retained plan." },
    ];

    const compacted2 = await compactMessages(client, "claude-sonnet", secondPassMessages, 2);
    const secondPrompt = compactionPromptFrom(create, 1);
    const compactedText2 = compacted2[0].content as string;

    expect(secondPrompt).toContain(planToken);
    expect(compactedText2).toContain(planToken);
    expect(compactedText2).not.toContain(signature);
  });
});
