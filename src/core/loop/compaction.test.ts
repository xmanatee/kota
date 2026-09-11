import { describe, expect, it, vi } from "vitest";
import type { KotaMessage, KotaToolUseBlock } from "#core/agent-harness/message-protocol.js";
import type { MessageCreateParams, ModelClient } from "#core/model/model-client.js";
import { compactMessages } from "./compaction.js";

function summarizer(reply: (input: string) => string = () => "Narrative") {
  const create = vi.fn(async (params: MessageCreateParams) => ({
    id: "summary", role: "assistant" as const, model: params.model, stop_reason: "end_turn" as const,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "text" as const, text: reply(String(params.messages[0].content)) }],
  }));
  const client: ModelClient = { messages: { create, stream() { throw new Error("unexpected streaming request"); } } };
  return { client, create };
}
function call(name: string, input: KotaToolUseBlock["input"], id = "call"): KotaMessage {
  return { role: "assistant", content: [{ type: "tool_use", id, name, input }] };
}
function result(content: string, is_error = false): KotaMessage {
  return { role: "user", content: [{ type: "tool_result", tool_use_id: "call", content, is_error }] };
}

describe("compaction", () => {
  it.each(["success", "provider failure"])("preserves exact working facts with %s", async (outcome) => {
    const { client } = summarizer(() => { if (outcome === "provider failure") throw new Error("offline"); return "Independent narrative"; });
    const messages: KotaMessage[] = [
      { role: "user", content: "Repair login" }, call("file_read", { path: "unmodified.ts" }),
      call("file_edit", { file_path: "auth.ts" }), call("file_write", { path: "token.ts" }),
      call("multi_edit", { edits: [{ file_path: "auth.ts" }, { file_path: "routes.ts" }] }),
      call("shell", { command: "pnpm test" }), call("shell", { command: "pnpm test" }),
      call("process", { action: "start", command: "pnpm dev" }),
      call("process", { action: "output", command: "not-started" }),
      result("failed login", true), result("successful result"),
    ];
    const compacted = await compactMessages(client, "model", messages, 2);
    expect(compacted.map((message) => message.role)).toEqual(["user", "assistant"]);
    const text = String(compacted[0].content);
    expect(text).toContain("Context compaction #2");
    expect(text).toContain("Files modified: auth.ts, token.ts, routes.ts\n");
    expect(text).toContain("Commands run: pnpm test; [bg] pnpm dev\n");
    expect(text).toContain("Errors hit:\n  - failed login\nTotal tool calls: 8");
    expect(text).toContain(outcome === "success" ? "Independent narrative" : "Repair login");
  });

  it("bounds retained commands and errors without losing their most recent identities", async () => {
    const { client } = summarizer();
    const messages = [
      ...Array.from({ length: 20 }, (_, i) => call("shell", { command: `cmd-${i}` })),
      ...Array.from({ length: 8 }, (_, i) => result(`error-${i}`, true)),
    ];
    const [summary] = await compactMessages(client, "model", messages, 1);
    const text = String(summary.content);
    expect(text).toContain(`Commands run: ${Array.from({ length: 15 }, (_, i) => `cmd-${i + 5}`).join("; ")}\n`);
    expect(text).toContain(`Errors hit:\n${Array.from({ length: 5 }, (_, i) => `  - error-${i + 3}`).join("\n")}\n`);
    expect(text).not.toMatch(/cmd-[0-4](?:;|\n)|error-[0-2]/);
  });

  it("bounds long command and error payloads in the deterministic summary", async () => {
    const { client } = summarizer();
    const [summary] = await compactMessages(client, "model", [
      call("shell", { command: `${"c".repeat(200)}command-tail` }),
      call("process", { action: "start", command: `${"b".repeat(200)}background-tail` }),
      result(`${"e".repeat(300)}error-tail`, true),
    ], 1);
    const text = String(summary.content);
    expect(text).toContain(`${"c".repeat(120)}...; [bg] ${"b".repeat(115)}...\n`);
    expect(text).toContain(`${"e".repeat(200)}...\n`);
    expect(text).not.toMatch(/command-tail|background-tail|error-tail/);
  });

  it("passes bounded rationale and mixed content to the model, excluding provider signatures", async () => {
    const { client, create } = summarizer(() => "provider-signature must be redacted");
    const messages: KotaMessage[] = [
      { role: "user", content: "Repair login" },
      { role: "assistant", content: [
        { type: "thinking", thinking: `active-plan ${"x".repeat(900)} excluded-tail`, signature: "provider-signature" },
        { type: "text", text: "Inspect before editing" },
        { type: "tool_use", id: "read", name: "file_read", input: { path: "auth.ts" } },
      ] },
    ];
    const [summary] = await compactMessages(client, "selected-model", messages, 1);
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("selected-model");
    const prompt = String(request.messages[0].content);
    expect(prompt).toContain("Inspect before editing");
    expect(prompt).toContain("file_read");
    for (const text of [prompt, String(summary.content)]) {
      expect(text).toContain("active-plan");
      expect(text).toContain("[truncated]");
      expect(text).not.toMatch(/excluded-tail|provider-signature/);
    }
    expect(summary.content).toContain("[redacted thinking signature]");
  });

  it("carries the selected rationale through repeated summaries beyond the ordinary text window", async () => {
    const { client, create } = summarizer((prompt) => prompt.includes("plan-7") ? "Retained current plan" : "Lost plan");
    const messages: KotaMessage[] = [
      ...Array.from({ length: 70 }, (_, i) => call("file_edit", { file_path: `src/long-working-state-${i}.ts` })),
      ...Array.from({ length: 8 }, (_, i): KotaMessage => ({
        role: "assistant", content: [{ type: "thinking", thinking: `plan-${i}`, signature: `signature-${i}` }],
      })),
    ];
    const first = await compactMessages(client, "model", messages, 1);
    expect(String(first[0].content).slice(0, 800)).not.toContain("plan-7");
    const second = await compactMessages(client, "model", first, 2);
    for (const text of [String(first[0].content), String(second[0].content), ...create.mock.calls.map(([p]) => String(p.messages[0].content))]) {
      expect(text).not.toMatch(/plan-[01]|signature-/);
      for (let i = 2; i < 8; i++) expect(text).toContain(`plan-${i}`);
    }
    expect(second[0].content).toContain("Retained current plan");
  });
});
