import { describe, it, expect, afterEach } from "vitest";
import { REPLSession, sessions, cleanupSessions } from "./repl-session.js";
import { SENTINEL, DONE_MARKER } from "./code-wrappers.js";

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

describe("REPLSession execute (cross-module: code-wrappers → subprocess)", () => {
  let session: REPLSession;

  afterEach(() => {
    session?.kill();
  });

  it("executes Python code and returns output", async () => {
    session = new REPLSession("python");
    const result = await session.execute("print('hello from python')", 10_000);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("hello from python");
  });

  it("executes Node.js code and returns output", async () => {
    session = new REPLSession("node");
    const result = await session.execute("console.log('hello from node')", 10_000);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("hello from node");
  });

  it("preserves state across sequential Python calls", async () => {
    session = new REPLSession("python");
    await session.execute("x = 42", 10_000);
    const result = await session.execute("print(x)", 10_000);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("42");
  });

  it("collects stderr alongside stdout", async () => {
    session = new REPLSession("python");
    const result = await session.execute(
      "import sys; print('out_line'); sys.stderr.write('err_line\\n')",
      10_000,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("out_line");
    expect(result.output).toContain("err_line");
  });

  it("transparently restarts process after kill", async () => {
    session = new REPLSession("python");
    const r1 = await session.execute("print('before')", 10_000);
    expect(r1.output).toContain("before");

    session.kill();
    expect(session.isAlive()).toBe(false);

    const r2 = await session.execute("print('after')", 10_000);
    expect(r2.output).toContain("after");
    expect(session.isAlive()).toBe(true);
  });

  it("handles timeout with graceful SIGINT for Python", async () => {
    session = new REPLSession("python");
    const result = await session.execute("import time; time.sleep(100)", 500);
    const hasInterrupt = result.output.includes("[Interrupted");
    const hasTimeout = result.output.includes("timed out");
    expect(hasInterrupt || hasTimeout).toBe(true);
  }, 15_000);

  it("output is clean — no sentinel or done marker leakage", async () => {
    session = new REPLSession("python");
    const result = await session.execute("print('clean')", 10_000);
    expect(result.output).not.toContain(SENTINEL);
    expect(result.output).not.toContain(DONE_MARKER);
    expect(result.output).toContain("clean");
  });
});
