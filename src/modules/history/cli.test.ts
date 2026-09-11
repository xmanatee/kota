import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetActiveKotaClient, setActiveKotaClient } from "#core/server/client-holder.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { setTerminalTransport, TerminalTransport } from "#modules/rendering/transport.js";
import { resolveExplicitConversationResume, resolveRunContinue, validateConversationResumeCwd } from "./cli.js";
import { registerHistoryCommands } from "./cli-commands.js";
import type { HistoryClient } from "./client.js";
import { ConversationHistory } from "./history.js";
import { listLocalScopeHistoryRecords } from "./local-history-scan.js";
import { showHistory } from "./operations.js";

vi.mock("#core/modules/cli-providers.js", () => ({ ensureCliProvidersFor: async () => {} }));

let root: string;
let previousCwd: string;
let history: ConversationHistory;
let id: string;
let output: string;
let errors: string;
const search = vi.fn<HistoryClient["search"]>();
const show = vi.fn<HistoryClient["show"]>();
const list = vi.fn<HistoryClient["list"]>();
function makeClient() {
  return createKotaClientTestDouble({ history: {
    search, show, list,
    async listDiscoveredScopeRecords(filter) {
      return { conversations: listLocalScopeHistoryRecords({ cwd: process.cwd(), limit: filter?.limit }) };
    },
  } });
}
function command(...args: string[]) {
  const program = new Command().exitOverride();
  registerHistoryCommands(program);
  return program.parseAsync(["node", "kota", "history", ...args]);
}
beforeEach(() => {
  previousCwd = process.cwd();
  root = realpathSync(mkdtempSync(join(tmpdir(), "kota-history-cli-")));
  mkdirSync(join(root, "caller"));
  process.chdir(join(root, "caller"));
  vi.stubEnv("KOTA_SCOPE_ROOT", process.cwd());
  history = new ConversationHistory(join(root, "saved", ".kota", "history"));
  id = history.create("model", join(root, "saved"));
  history.save(id, [{ role: "user", content: "First chat" }], 0, 0);
  search.mockReset().mockResolvedValue({ ok: true, conversations: [] });
  list.mockReset().mockImplementation(async () => ({ conversations: history.list() }));
  show.mockReset().mockImplementation(async (id, options) => showHistory(history, id, options));
  setActiveKotaClient(makeClient());
  output = "";
  errors = "";
  setTerminalTransport(new TerminalTransport({
    stream: { write(chunk: string) { output += chunk; return true; }, isTTY: false, columns: 100 },
    theme: NO_COLOR_THEME, width: 100,
  }));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { output += chunk.toString(); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => { errors += chunk.toString(); return true; });
  vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit:${code}`); });
});
afterEach(() => {
  setTerminalTransport(null);
  resetActiveKotaClient();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
});

describe("history search command", () => {
  it("renders every result with identifying metadata", async () => {
    const second = history.create("model", "/another");
    history.save(second, [{ role: "user", content: "Second chat" }], 0, 0);
    search.mockResolvedValue({ ok: true, conversations: history.list() });
    await command("search", "hello");
    expect(search.mock.calls).toEqual([["hello", { semantic: true, limit: 20, cwd: process.cwd() }]]);
    for (const value of [id, second, "First chat", "Second chat", "1 msgs", history.load(id)!.record.updatedAt.slice(0, 10)]) {
      expect(output).toContain(value);
    }
  });
  it.each(["--keyword", "--no-semantic"])("propagates explicit keyword selection %s and all-scope limit", async (flag) => {
    await command("search", "hello", flag, "--all", "--limit", "3");
    expect(search.mock.calls).toEqual([["hello", { semantic: false, limit: 3, cwd: undefined }]]);
    expect(output).toContain("No matching conversations.");
  });
  it("rejects whitespace input before sending a request", async () => {
    await expect(command("search", "   ")).rejects.toThrow("exit:1");
    expect(search).not.toHaveBeenCalled();
    expect(errors).toContain("Usage: kota history search <query>");
  });
  it("reports unavailable semantic search without retrying as keyword", async () => {
    search.mockResolvedValue({ ok: false, reason: "semantic_unavailable" });
    await expect(command("search", "hello")).rejects.toThrow("exit:1");
    expect(search.mock.calls).toEqual([["hello", { semantic: true, limit: 20, cwd: process.cwd() }]]);
    expect(errors).toContain("requires an embedding-backed history provider");
  });
  it.each([true, false])("preserves structured search outcome: ok=%s", async (ok) => {
    const result = ok
      ? { ok: true as const, conversations: history.list() }
      : { ok: false as const, reason: "semantic_unavailable" as const };
    search.mockResolvedValue(result);
    await command("search", "hello", "--json");
    expect(JSON.parse(output)).toEqual(result);
  });
});

describe("history show command", () => {
  it("renders the selected bounded message window and truncation metadata", async () => {
    history.save(id, Array.from({ length: 205 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user", content: `${i}: ${"x".repeat(236)}`,
    })), 0, 0);
    await command("show", id, "--offset", "40", "--limit", "2", "--content-limit", "12");
    expect(show.mock.calls).toEqual([[id, { view: "window", offset: 40, limit: 2, contentLimit: 12 }]]);
    for (const value of ["First chat", "window", "40-41 of 205", "[40 user]", "[41 assistant]", "truncated 12/240"]) {
      expect(output).toContain(value);
    }
    expect(output).not.toContain("[39 assistant]");
    expect(output).not.toContain("x".repeat(13));
  });
  it("renders metadata without message text", async () => {
    await command("show", id, "--view", "metadata");
    expect(show.mock.calls).toEqual([[id, { view: "metadata" }]]);
    expect(output).toContain("metadata");
    expect(output).toContain("0-0 of 1");
    expect(output).not.toContain("[0 user]");
  });
  it.each([
    [["--view", "bogus"], "--view must be one of metadata, window, full"],
    [["--view", "full", "--limit", "2"], "only valid with --view window"],
  ])("rejects invalid detail arguments %j", async (args, error) => {
    await expect(command("show", id, ...args)).rejects.toThrow("exit:1");
    expect(show).not.toHaveBeenCalled();
    expect(errors).toContain(error);
  });
});

describe("conversation resume selection", () => {
  it("explicit continuation selects the saved directory", async () => {
    expect(await resolveRunContinue(makeClient(), { continue: id })).toMatchObject({
      id, scopeRoot: join(root, "saved"), explicit: true, cwdOverridden: false,
    });
  });
  it("discovers an explicitly requested conversation in a sibling scope", async () => {
    list.mockResolvedValue({ conversations: [] });
    expect(await resolveRunContinue(makeClient(), { continue: id })).toMatchObject({
      id, scopeRoot: join(root, "saved"), explicit: true,
    });
  });
  it("bare continuation requests only the caller's latest conversation", async () => {
    expect(await resolveRunContinue(makeClient(), { continue: true })).toMatchObject({
      id, scopeRoot: process.cwd(), explicit: false,
    });
    expect(list.mock.calls).toEqual([[{ cwd: process.cwd(), limit: 1 }]]);
  });
  it("missing saved directory rejects by default and allows an explicit caller override", async () => {
    const record = { ...history.load(id)!.record, cwd: join(root, "gone") };
    list.mockResolvedValue({ conversations: [record] });
    expect(validateConversationResumeCwd(record)).toMatchObject({
      ok: false, message: expect.stringContaining("saved cwd is missing or inaccessible"),
    });
    await expect(resolveExplicitConversationResume(makeClient(), id)).rejects.toThrow("exit:1");
    expect(errors).toContain("--resume-here");
    expect(await resolveExplicitConversationResume(makeClient(), id, { resumeHere: true })).toMatchObject({
      scopeRoot: process.cwd(), savedCwd: record.cwd, cwdOverridden: true,
    });
  });
});
