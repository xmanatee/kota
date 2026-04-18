import { describe, expect, it } from "vitest";
import type { InteractiveSession } from "./daemon-control.js";
import { sweepExpiredSessions } from "./session-sweep.js";

function makeSession(id: string, lastActive: number): InteractiveSession {
  return {
    id,
    createdAt: new Date(lastActive).toISOString(),
    lastActive,
    autonomyMode: "supervised",
  };
}

describe("sweepExpiredSessions", () => {
  it("removes sessions whose lastActive exceeds the TTL", () => {
    const now = 1_000_000;
    const ttl = 60_000;
    const sessions = new Map<string, InteractiveSession>([
      ["old-session", makeSession("old-session", now - ttl - 1)],
      ["fresh-session", makeSession("fresh-session", now - ttl + 1)],
    ]);

    const expired = sweepExpiredSessions(sessions, now, ttl);

    expect(expired).toEqual(["old-session"]);
    expect(sessions.has("old-session")).toBe(false);
    expect(sessions.has("fresh-session")).toBe(true);
  });

  it("returns empty array when no sessions are expired", () => {
    const now = 1_000_000;
    const sessions = new Map<string, InteractiveSession>([
      ["session-a", makeSession("session-a", now - 1000)],
    ]);

    const expired = sweepExpiredSessions(sessions, now, 60_000);

    expect(expired).toEqual([]);
    expect(sessions.size).toBe(1);
  });

  it("returns empty array for empty session map", () => {
    const expired = sweepExpiredSessions(new Map(), Date.now(), 60_000);
    expect(expired).toEqual([]);
  });

  it("removes all sessions when all have exceeded the TTL", () => {
    const now = 1_000_000;
    const sessions = new Map<string, InteractiveSession>([
      ["s1", makeSession("s1", now - 999_999)],
      ["s2", makeSession("s2", now - 999_998)],
    ]);

    const expired = sweepExpiredSessions(sessions, now, 60_000);

    expect(expired).toHaveLength(2);
    expect(sessions.size).toBe(0);
  });

  it("does not remove a session whose lastActive equals now minus TTL exactly (boundary is exclusive)", () => {
    const now = 1_000_000;
    const ttl = 60_000;
    const sessions = new Map<string, InteractiveSession>([
      ["boundary", makeSession("boundary", now - ttl)],
    ]);

    const expired = sweepExpiredSessions(sessions, now, ttl);

    expect(expired).toEqual([]);
    expect(sessions.has("boundary")).toBe(true);
  });
});
