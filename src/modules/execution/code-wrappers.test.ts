import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEOUT,
  DONE_MARKER,
  ENV_MARKER,
  MAX_OUTPUT,
  NODE_WRAPPER,
  PYTHON_WRAPPER,
  SENTINEL,
} from "./code-wrappers.js";

// Helper: run Python wrapper, send code, collect output
function runPython(code: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", ["-c", PYTHON_WRAPPER], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => resolve({ stdout, stderr }));
    proc.on("error", reject);
    proc.stdin.write(`${code}\n${SENTINEL}\n`);
    // Close stdin to let the wrapper exit after processing
    setTimeout(() => proc.stdin.end(), 200);
  });
}

// Helper: run Node.js wrapper, send code, collect output
function runNode(code: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["-e", NODE_WRAPPER], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", () => resolve({ stdout, stderr }));
    proc.on("error", reject);
    proc.stdin.write(`${code}\n${SENTINEL}\n`);
    setTimeout(() => proc.stdin.end(), 200);
  });
}

describe("code-wrappers constants", () => {
  it("exports expected protocol markers", () => {
    expect(SENTINEL).toBe("__KOTA_EXEC__");
    expect(DONE_MARKER).toBe("__KOTA_DONE__");
    expect(ENV_MARKER).toBe("__KOTA_ENV__");
  });

  it("exports valid default limits", () => {
    expect(DEFAULT_TIMEOUT).toBe(30_000);
    expect(MAX_OUTPUT).toBe(50_000);
  });
});

describe("PYTHON_WRAPPER protocol", () => {
  it("contains sentinel and done marker", () => {
    expect(PYTHON_WRAPPER).toContain(SENTINEL);
    expect(PYTHON_WRAPPER).toContain(DONE_MARKER);
  });

  it("sets MPLBACKEND=Agg for headless matplotlib", () => {
    expect(PYTHON_WRAPPER).toContain("MPLBACKEND");
    expect(PYTHON_WRAPPER).toContain("Agg");
  });

  it("evaluates a pure expression and prints result", async () => {
    const { stdout } = await runPython("1 + 2");
    expect(stdout).toContain("3");
    expect(stdout).toContain(DONE_MARKER);
  });

  it("handles statement + trailing expression (AST extraction)", async () => {
    const { stdout } = await runPython("x = 10\nx * 2");
    expect(stdout).toContain("20");
    expect(stdout).toContain(DONE_MARKER);
  });

  it("handles pure statements without trailing expression", async () => {
    const { stdout } = await runPython('print("hello")');
    expect(stdout).toContain("hello");
    expect(stdout).toContain(DONE_MARKER);
  });

  it("catches exceptions without crashing", async () => {
    const { stdout, stderr } = await runPython("1/0");
    expect(stdout).toContain(DONE_MARKER);
    expect(stderr).toContain("ZeroDivisionError");
  });
});

describe("NODE_WRAPPER protocol", () => {
  it("contains sentinel and done marker", () => {
    expect(NODE_WRAPPER).toContain(SENTINEL);
    expect(NODE_WRAPPER).toContain(DONE_MARKER);
  });

  it("evaluates an expression and prints result", async () => {
    const { stdout } = await runNode("2 + 3");
    expect(stdout).toContain("5");
    expect(stdout).toContain(DONE_MARKER);
  });

  it("handles object results as JSON", async () => {
    const { stdout } = await runNode('({a: 1, b: "two"})');
    expect(stdout).toContain(DONE_MARKER);
    const lines = stdout.split("\n").filter((l) => l && l !== DONE_MARKER);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed).toEqual({ a: 1, b: "two" });
  });

  it("catches errors without crashing", async () => {
    const { stdout, stderr } = await runNode("throw new Error('boom')");
    expect(stdout).toContain(DONE_MARKER);
    expect(stderr).toContain("boom");
  });
});
