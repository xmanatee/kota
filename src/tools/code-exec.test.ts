import { describe, it, expect, afterAll } from "vitest";
import { runCodeExec, cleanupSessions, detectPackageHint } from "./code-exec.js";

afterAll(() => {
  cleanupSessions();
});

describe("code_exec tool", () => {
  describe("input validation", () => {
    it("requires code parameter", async () => {
      const result = await runCodeExec({});
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("code is required");
    });

    it("rejects invalid language", async () => {
      const result = await runCodeExec({ code: "1+1", language: "ruby" });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("python");
      expect(result.content).toContain("node");
    });
  });

  describe("python execution", () => {
    it("evaluates an expression", async () => {
      const result = await runCodeExec({ code: "2 + 3", language: "python" });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("5");
    });

    it("executes statements with print", async () => {
      const result = await runCodeExec({
        code: 'print("hello from python")',
        language: "python",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("hello from python");
    });

    it("persists state across calls", async () => {
      await runCodeExec({ code: "x = 42", language: "python" });
      const result = await runCodeExec({ code: "x * 2", language: "python" });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("84");
    });

    it("handles imports", async () => {
      const result = await runCodeExec({
        code: "import math\nmath.sqrt(144)",
        language: "python",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("12");
    });

    it("reports syntax errors without crashing", async () => {
      const result = await runCodeExec({
        code: "def broken(",
        language: "python",
      });
      expect(result.content).toContain("SyntaxError");
    });

    it("reports runtime errors without crashing", async () => {
      const result = await runCodeExec({
        code: "1 / 0",
        language: "python",
      });
      expect(result.content).toContain("ZeroDivisionError");
    });

    it("continues working after an error", async () => {
      await runCodeExec({ code: "bad_var", language: "python" });
      const result = await runCodeExec({
        code: "2 + 2",
        language: "python",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("4");
    });

    it("handles multi-line code blocks", async () => {
      const code = [
        "def factorial(n):",
        "    if n <= 1: return 1",
        "    return n * factorial(n - 1)",
        "",
        "factorial(10)",
      ].join("\n");
      const result = await runCodeExec({ code, language: "python" });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("3628800");
    });

    it("resets session when requested", async () => {
      await runCodeExec({ code: "persist_var = 99", language: "python" });
      const before = await runCodeExec({ code: "persist_var", language: "python" });
      expect(before.content).toContain("99");

      const after = await runCodeExec({
        code: "persist_var",
        language: "python",
        reset: true,
      });
      expect(after.content).toContain("NameError");
    });
  });

  describe("node execution", () => {
    it("evaluates an expression", async () => {
      const result = await runCodeExec({
        code: "2 + 3",
        language: "node",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("5");
    });

    it("executes console.log", async () => {
      const result = await runCodeExec({
        code: 'console.log("hello from node")',
        language: "node",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("hello from node");
    });

    it("persists state across calls", async () => {
      await runCodeExec({
        code: "var nodeVar = 100;",
        language: "node",
        reset: true,
      });
      const result = await runCodeExec({
        code: "nodeVar + 1",
        language: "node",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("101");
    });

    it("reports errors without crashing", async () => {
      const result = await runCodeExec({
        code: "throw new Error('test error')",
        language: "node",
      });
      expect(result.content).toContain("test error");
    });

    it("continues working after an error", async () => {
      await runCodeExec({
        code: "undefinedVar.foo",
        language: "node",
      });
      const result = await runCodeExec({
        code: "1 + 1",
        language: "node",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("2");
    });
  });

  describe("package hint detection", () => {
    it("detects Python missing module", () => {
      const output = `Traceback (most recent call last):
  File "<exec>", line 1, in <module>
ModuleNotFoundError: No module named 'pandas'`;
      expect(detectPackageHint(output, "python")).toBe(
        "Tip: Install the missing package with shell: pip install pandas",
      );
    });

    it("extracts top-level package from dotted import", () => {
      const output = "ModuleNotFoundError: No module named 'sklearn.ensemble'";
      expect(detectPackageHint(output, "python")).toBe(
        "Tip: Install the missing package with shell: pip install sklearn",
      );
    });

    it("detects Node.js missing module", () => {
      const output = "Error: Cannot find module 'lodash'";
      expect(detectPackageHint(output, "node")).toBe(
        "Tip: Install the missing package with shell: npm install lodash",
      );
    });

    it("ignores relative path imports in Node.js", () => {
      const output = "Error: Cannot find module './utils'";
      expect(detectPackageHint(output, "node")).toBeNull();
    });

    it("returns null when no import error", () => {
      expect(detectPackageHint("ZeroDivisionError: division by zero", "python")).toBeNull();
      expect(detectPackageHint("42", "node")).toBeNull();
    });
  });

  describe("timeout handling", () => {
    it("times out on long-running code", async () => {
      const result = await runCodeExec({
        code: "import time; time.sleep(60)",
        language: "python",
        timeout_ms: 1000,
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("timed out");
    });

    it("recovers after timeout", async () => {
      await runCodeExec({
        code: "import time; time.sleep(60)",
        language: "python",
        timeout_ms: 1000,
      });
      const result = await runCodeExec({
        code: "1 + 1",
        language: "python",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("2");
    });
  });
});
