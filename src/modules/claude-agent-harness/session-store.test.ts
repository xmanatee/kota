import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionInfo, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { expect, it, vi } from "vitest";
import { createClaudeSessionStore } from "./session-store.js";

it("retains native SDK transcript entries and subagents across store replacement, checkpointing identity before return", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-claude-store-"));
  try {
    const onSessionId = vi.fn();
    const store = createClaudeSessionStore(root, onSessionId);
    const key = { projectKey: "../scope", sessionId: "explicit-native-id" };
    const entries = [{ type: "assistant", uuid: "entry-1", message: { content: [{ type: "text", text: "blue" }] } }];
    await store.append(key, entries);
    expect(onSessionId).toHaveBeenCalledWith(key.sessionId);
    await store.append(key, entries);
    await store.append({ ...key, subpath: "subagents/child" }, [{ type: "user", message: "subagent work" }]);
    const resumed = createClaudeSessionStore(root);
    expect(await resumed.load(key)).toEqual(entries);
    expect(await resumed.listSubkeys!(key)).toEqual(["subagents/child"]);
    expect(await resumed.load({ ...key, projectKey: "other scope" })).toBeNull();
    expect(readdirSync(root).every((name) => (statSync(join(root, name)).mode & 0o777) === 0o600)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("serves the installed SDK's native session readers after replacing the store", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-claude-sdk-reader-"));
  try {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const dir = "/session-store-fixture";
    const timestamp = "2026-09-11T00:00:00.000Z";
    const store = createClaudeSessionStore(root);
    await store.append({ projectKey: "-session-store-fixture", sessionId }, [
      { type: "user", uuid: "user-1", parentUuid: null, sessionId, timestamp, cwd: dir, message: { role: "user", content: "Remember the blue design" } },
      { type: "assistant", uuid: "assistant-1", parentUuid: "user-1", sessionId, timestamp, cwd: dir, message: { role: "assistant", content: [{ type: "text", text: "The design is blue." }] } },
    ]);
    const sessionStore = createClaudeSessionStore(root);
    expect(await getSessionInfo(sessionId, { dir, sessionStore })).toMatchObject({ sessionId });
    expect(JSON.stringify(await getSessionMessages(sessionId, { dir, sessionStore }))).toContain("The design is blue.");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
