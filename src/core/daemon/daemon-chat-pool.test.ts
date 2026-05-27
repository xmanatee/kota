import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cloneGuardrailsConfig,
  createGuardrailsSnapshot,
  fingerprintGuardrailsConfig,
  type GuardrailsConfig,
} from "#core/tools/guardrails.js";
import { DaemonChatBindingStore } from "./daemon-chat-bindings.js";
import { deleteDaemonSession } from "./daemon-chat-handlers.js";
import { DaemonChatPool } from "./daemon-chat-pool.js";

const CONV_ID = "c-fixture-0000";
const PROJECT_ID = "test-project-id";
const OTHER_PROJECT_ID = "other-project-id";

function makeBindingStore(): DaemonChatBindingStore {
  const dir = mkdtempSync(join(tmpdir(), "kota-chat-bindings-"));
  return new DaemonChatBindingStore(dir);
}

function mockAgentSession(sendResult?: unknown, mode: "passive" | "supervised" | "autonomous" = "supervised") {
  let current = mode;
  let guardrailsConfig: GuardrailsConfig = {
    policies: { safe: "allow", moderate: "allow", dangerous: "confirm" },
  };
  let guardrailsSnapshot = createGuardrailsSnapshot(guardrailsConfig, 0);
  return {
    send: vi.fn(async () => sendResult ?? { status: "ok" }),
    cancelActiveTurn: vi.fn(),
    close: vi.fn(),
    getAutonomyMode: vi.fn(() => current),
    setAutonomyMode: vi.fn((next: "passive" | "supervised" | "autonomous") => { current = next; }),
    getGuardrailsSnapshot: vi.fn(() => ({ ...guardrailsSnapshot })),
    replaceGuardrailsConfig: vi.fn((nextConfig: GuardrailsConfig) => {
      const nextId = fingerprintGuardrailsConfig(nextConfig);
      if (nextId === guardrailsSnapshot.id) {
        return { changed: false, snapshot: { ...guardrailsSnapshot } };
      }
      guardrailsConfig = cloneGuardrailsConfig(nextConfig);
      guardrailsSnapshot = createGuardrailsSnapshot(
        guardrailsConfig,
        guardrailsSnapshot.generation + 1,
      );
      return { changed: true, snapshot: { ...guardrailsSnapshot } };
    }),
  };
}

function makePool(opts?: { maxSessions?: number; ttlMs?: number }) {
  return new DaemonChatPool(opts);
}

// --- DaemonChatPool ---

describe("DaemonChatPool", () => {
  it("creates a session with unique id", () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    expect(session.id).toBeTruthy();
    expect(session.projectId).toBe(PROJECT_ID);
    expect(session.conversationId).toBe(CONV_ID);
    expect(pool.size).toBe(1);
    expect(pool.get(session.id)).toBe(session);
  });

  it("list returns source daemon", () => {
    const pool = makePool();
    pool.create(() => mockAgentSession() as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    const list = pool.list();
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe("daemon");
    expect(list[0].projectId).toBe(PROJECT_ID);
  });

  it("list can filter by project id", () => {
    const pool = makePool();
    pool.create(() => mockAgentSession() as never, "supervised", "conv-a", { projectId: PROJECT_ID });
    pool.create(() => mockAgentSession() as never, "supervised", "conv-b", { projectId: OTHER_PROJECT_ID });
    expect(pool.list(PROJECT_ID).map((s) => s.conversationId)).toEqual(["conv-a"]);
  });

  it("delete closes agent, removes session, and clears its binding", () => {
    const pool = makePool();
    const bindings = makeBindingStore();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    bindings.put(session.id, CONV_ID, PROJECT_ID);
    expect(deleteDaemonSession(pool, session.id, bindings)).toBe(true);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
    expect(bindings.getBySession(session.id)).toBeUndefined();
  });

  it("delete returns false for unknown id", () => {
    const pool = makePool();
    expect(deleteDaemonSession(pool, "nope")).toBe(false);
  });

  it("evicts oldest idle session when at capacity", () => {
    const pool = makePool({ maxSessions: 2 });
    const a1 = mockAgentSession();
    const s1 = pool.create(() => a1 as never, "supervised", "conv-a", { projectId: PROJECT_ID });
    s1.lastActive = 1000;
    const s2 = pool.create(() => mockAgentSession() as never, "supervised", "conv-b", { projectId: PROJECT_ID });
    s2.lastActive = 2000;
    pool.create(() => mockAgentSession() as never, "supervised", "conv-c", { projectId: PROJECT_ID }); // evicts s1
    expect(pool.get(s1.id)).toBeUndefined();
    expect(a1.close).toHaveBeenCalled();
    expect(pool.size).toBe(2);
  });

  it("cleanup removes idle sessions past TTL", () => {
    const pool = makePool({ ttlMs: 1000 });
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    session.lastActive = Date.now() - 2000;
    expect(pool.cleanup()).toBe(1);
    expect(pool.size).toBe(0);
    expect(agent.close).toHaveBeenCalled();
  });

  it("cleanup preserves busy sessions", () => {
    const pool = makePool({ ttlMs: 1000 });
    const session = pool.create(() => mockAgentSession() as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    session.lastActive = Date.now() - 2000;
    session.busy = true;
    expect(pool.cleanup()).toBe(0);
    expect(pool.size).toBe(1);
  });

  it("closeAll closes all and empties pool", () => {
    const pool = makePool();
    const a1 = mockAgentSession();
    const a2 = mockAgentSession();
    pool.create(() => a1 as never, "supervised", "conv-a", { projectId: PROJECT_ID });
    pool.create(() => a2 as never, "supervised", "conv-b", { projectId: PROJECT_ID });
    pool.closeAll();
    expect(pool.size).toBe(0);
    expect(a1.close).toHaveBeenCalled();
    expect(a2.close).toHaveBeenCalled();
  });

  it("create rejects a sessionId that is already live", () => {
    const pool = makePool();
    const s1 = pool.create(() => mockAgentSession() as never, "supervised", "conv-a", { projectId: PROJECT_ID, sessionId: "reuse-id" });
    expect(s1.id).toBe("reuse-id");
    expect(() => pool.create(() => mockAgentSession() as never, "supervised", "conv-b", { projectId: PROJECT_ID, sessionId: "reuse-id" })).toThrow();
  });

  it("create accepts a caller-supplied sessionId to wake a prior session", () => {
    const pool = makePool();
    const session = pool.create(() => mockAgentSession() as never, "supervised", "conv-a", { projectId: PROJECT_ID, sessionId: "resumed-123" });
    expect(session.id).toBe("resumed-123");
    expect(session.conversationId).toBe("conv-a");
  });

  it("cancelActiveTurn aborts the current turn without deleting the session", () => {
    const pool = makePool();
    const agent = mockAgentSession();
    const session = pool.create(() => agent as never, "supervised", CONV_ID, { projectId: PROJECT_ID });
    expect(pool.cancelActiveTurn(session.id)).toBe(true);
    expect(agent.cancelActiveTurn).toHaveBeenCalledTimes(1);
    expect(pool.get(session.id)).toBe(session);
  });
});
