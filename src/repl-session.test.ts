import { describe, it, expect } from "vitest";
import { REPLSession, sessions, cleanupSessions } from "./repl-session.js";

describe("REPLSession", () => {
  it("starts not alive", () => {
    const session = new REPLSession("python");
    expect(session.isAlive()).toBe(false);
  });

  it("kill on fresh session is a no-op", () => {
    const session = new REPLSession("node");
    expect(() => session.kill()).not.toThrow();
    expect(session.isAlive()).toBe(false);
  });

  it("kill is idempotent", () => {
    const session = new REPLSession("python");
    session.kill();
    session.kill();
    expect(session.isAlive()).toBe(false);
  });

  it("cleanupSessions does not throw", () => {
    expect(() => cleanupSessions()).not.toThrow();
  });

  it("sessions record has python and node entries", () => {
    expect(sessions.python).toBeInstanceOf(REPLSession);
    expect(sessions.node).toBeInstanceOf(REPLSession);
  });
});
