import { beforeEach, describe, expect, it, vi } from "vitest";
import { callSlackApi } from "./client.js";
import { dispatchSlackSlashCommand, parseSlackSlashCommand, type SlackCommandClients } from "./commands.js";

vi.mock("./client.js", async (original) => ({
  ...await original<typeof import("./client.js")>(),
  callSlackApi: vi.fn(),
}));

function clients(): SlackCommandClients {
  return {
    recall: { recall: vi.fn(async () => ({ ok: true as const, hits: [] })) },
    answer: {
      answer: vi.fn(async () => ({ ok: false as const, reason: "no_hits" as const })),
      log: vi.fn(async () => ({ entries: [] })),
      show: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const })),
    },
    capture: { capture: vi.fn(async () => ({ ok: false as const, reason: "ambiguous" as const, suggestions: [] })) },
    retract: { retract: vi.fn(async () => ({ ok: false as const, reason: "not_found" as const, target: "memory" as const, identifier: "id" })) },
    memory: { search: vi.fn(async () => ({ ok: true as const, entries: [] })) },
    knowledge: { search: vi.fn(async () => ({ ok: true as const, entries: [] })) },
    history: { search: vi.fn(async () => ({ ok: true as const, conversations: [] })) },
    tasks: { search: vi.fn(async () => ({ ok: true as const, tasks: [] })) },
    attention: { snapshot: vi.fn(() => ({ text: "Attention from scope" })) },
    digest: { snapshot: vi.fn(() => ({ text: "Digest from scope" })) },
  };
}

async function dispatch(text: string, ports: SlackCommandClients) {
  const parsed = parseSlackSlashCommand(text);
  if (!parsed) throw new Error("Expected command input");
  return dispatchSlackSlashCommand({ token: "token", channelId: "D-OWNER", parsed, clients: ports });
}

// Consumer: admitted Slack DM operator. Owner: Slack command adapter.
// Stimulus: Slack text; oracle: client arguments and chat.postMessage payload.
// Domain result variants belong to their module renderers. Cadence: owner.
describe("Slack command parsing and delivery", () => {
  beforeEach(() => vi.mocked(callSlackApi).mockReset());

  it("strips Slack mentions and command casing while preserving multiline arguments", async () => {
    const ports = clients();
    await dispatch("  <@U123> /CaPtUrE-to-tasks  Fix this\nwith context  ", ports);
    expect(ports.capture.capture).toHaveBeenCalledWith("Fix this\nwith context", { target: "tasks" });
    expect(parseSlackSlashCommand("hello bot")).toBeNull();
    expect(await dispatch("/unknown", ports)).toBe(false);
    expect(await dispatch("/retract memory id", ports)).toBe(false);
  });

  it("maps read commands to their namespace and preserves trimmed search arguments", async () => {
    const ports = clients();
    for (const store of ["memory", "knowledge", "history", "tasks"] as const) {
      await dispatch(`/${store}  boundary query `, ports);
      expect(ports[store].search).toHaveBeenCalledWith("boundary query", { semantic: true, limit: 10 });
      vi.mocked(ports[store].search).mockClear();
      await dispatch(`/${store}  `, ports);
      expect(ports[store].search).not.toHaveBeenCalled();
    }
    await dispatch("/recall  boundary query ", ports);
    expect(ports.recall.recall).toHaveBeenCalledWith("boundary query");
    await dispatch("/answer  explain this ", ports);
    expect(ports.answer.answer).toHaveBeenCalledWith("explain this");
    await dispatch("/answer-show record-1", ports);
    expect(ports.answer.show).toHaveBeenCalledWith("record-1");
  });

  it("rejects empty input before domain calls and parses positive answer-log limits", async () => {
    const ports = clients();
    for (const command of ["/recall", "/answer", "/answer-show", "/capture", "/retract-memory"]) {
      await dispatch(`${command}  `, ports);
    }
    expect(ports.recall.recall).not.toHaveBeenCalled();
    expect(ports.answer.answer).not.toHaveBeenCalled();
    expect(ports.answer.show).not.toHaveBeenCalled();
    expect(ports.capture.capture).not.toHaveBeenCalled();
    expect(ports.retract.retract).not.toHaveBeenCalled();
    for (const body of ["0", "-1", "2oops", "1.5"]) await dispatch(`/answer-log ${body}`, ports);
    expect(ports.answer.log).not.toHaveBeenCalled();
    await dispatch("/answer-log 3", ports);
    expect(ports.answer.log).toHaveBeenCalledWith({ limit: 3 });
    await dispatch("/answer-log", ports);
    expect(ports.answer.log).toHaveBeenLastCalledWith({ limit: 5 });
  });

  it("passes capture and retract targets without interpreting mutation results", async () => {
    const ports = clients();
    await dispatch("/capture remember this", ports);
    expect(ports.capture.capture).toHaveBeenCalledWith("remember this", undefined);
    for (const target of ["memory", "knowledge", "tasks", "inbox"]) {
      await dispatch(`/capture-to-${target} remember this`, ports);
      expect(ports.capture.capture).toHaveBeenLastCalledWith("remember this", { target });
      await dispatch(`/retract-${target} record-1`, ports);
      expect(ports.retract.retract).toHaveBeenLastCalledWith({ target, identifier: "record-1" });
    }
  });

  it("delivers snapshot text to the requesting DM and splits oversized replies in order", async () => {
    const ports = clients();
    await dispatch("/attention ignored body", ports);
    expect(callSlackApi).toHaveBeenLastCalledWith("token", "chat.postMessage", { channel: "D-OWNER", text: "Attention from scope" });
    const text = "x".repeat(9000);
    vi.mocked(ports.digest.snapshot).mockReturnValue({ text });
    vi.mocked(callSlackApi).mockClear();
    await dispatch("/digest", ports);
    const chunks = vi.mocked(callSlackApi).mock.calls.map(([, , body]) => body as { channel: string; text: string });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.channel === "D-OWNER" && chunk.text.length <= 4000)).toBe(true);
    expect(chunks.map(chunk => chunk.text).join("")).toBe(text);
  });
});
