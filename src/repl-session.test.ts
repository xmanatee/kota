import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DONE_MARKER, SENTINEL } from "./data/code-wrappers.js";
import { cleanupSessions, findPythonBinary, REPLSession, sessions } from "./repl-session.js";

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
  }, 15_000);

  it("handles timeout with graceful SIGINT for Python", async () => {
    session = new REPLSession("python");
    const result = await session.execute("import time; time.sleep(100)", 500);
    const hasInterrupt = result.output.includes("[Interrupted");
    const hasTimeout = result.output.includes("timed out");
    expect(hasInterrupt || hasTimeout).toBe(true);
  }, 15_000);

  it("reports state loss when process crashes during execution", async () => {
    session = new REPLSession("python");
    await session.execute("x = 42", 10_000);
    const result = await session.execute("import os; os._exit(1)", 10_000);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Session crashed");
    expect(result.output).toContain("state were lost");
  });

  it("auto-restarts after crash with restart warning", async () => {
    session = new REPLSession("python");
    await session.execute("x = 42", 10_000);
    await session.execute("import os; os._exit(1)", 10_000);
    const result = await session.execute("print('recovered')", 10_000);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Session restarted");
    expect(result.output).toContain("recovered");
  }, 15_000);

  it("explicit kill restart does not show crash warning", async () => {
    session = new REPLSession("python");
    await session.execute("x = 42", 10_000);
    session.kill();
    const result = await session.execute("print('clean')", 10_000);
    expect(result.isError).toBe(false);
    expect(result.output).not.toContain("Session restarted");
    expect(result.output).not.toContain("crashed");
    expect(result.output).toContain("clean");
  }, 15_000);

  it("Node.js crash reports state loss", async () => {
    session = new REPLSession("node");
    const result = await session.execute("process.exit(1)", 10_000);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Session crashed");
  });

  it("output is clean — no sentinel or done marker leakage", async () => {
    session = new REPLSession("python");
    const result = await session.execute("print('clean')", 10_000);
    expect(result.output).not.toContain(SENTINEL);
    expect(result.output).not.toContain(DONE_MARKER);
    expect(result.output).toContain("clean");
  });
});

describe("findPythonBinary", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kota-venv-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns python3 when no venv exists", () => {
    expect(findPythonBinary(testDir)).toBe("python3");
  });

  it("returns .venv/bin/python when .venv exists", () => {
    const binDir = join(testDir, ".venv", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "python"), "");
    expect(findPythonBinary(testDir)).toBe(join(testDir, ".venv", "bin", "python"));
  });

  it("returns venv/bin/python when venv exists", () => {
    const binDir = join(testDir, "venv", "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "python"), "");
    expect(findPythonBinary(testDir)).toBe(join(testDir, "venv", "bin", "python"));
  });

  it("prefers .venv over venv when both exist", () => {
    for (const dir of [".venv", "venv"]) {
      const binDir = join(testDir, dir, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, "python"), "");
    }
    expect(findPythonBinary(testDir)).toBe(join(testDir, ".venv", "bin", "python"));
  });
});
