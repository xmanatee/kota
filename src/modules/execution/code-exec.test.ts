import { execFile } from "node:child_process";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanupSessions, detectPackageHint, extractMissingPackage, runCodeExec } from "./code-exec.js";

const execFileMock = vi.hoisted(() =>
  vi.fn((...args: unknown[]) => {
    const callback = args.find((arg) => typeof arg === "function") as
      | ((error: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    if (callback) {
      callback(new Error("unexpected execFile call from code_exec"), "", "");
    }
    return {};
  }),
);

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, execFile: execFileMock };
});

afterAll(() => {
  cleanupSessions();
});

afterEach(() => {
  vi.clearAllMocks();
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
        "Tip: Install the missing package with shell: pnpm add lodash",
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

  describe("extractMissingPackage", () => {
    it("extracts package from Python ModuleNotFoundError", () => {
      const output = "ModuleNotFoundError: No module named 'pandas'";
      expect(extractMissingPackage(output, "python")).toBe("pandas");
    });

    it("extracts top-level from dotted import", () => {
      const output = "ModuleNotFoundError: No module named 'sklearn.ensemble'";
      expect(extractMissingPackage(output, "python")).toBe("sklearn");
    });

    it("python error does not match as node", () => {
      const output = "ModuleNotFoundError: No module named 'pandas'";
      expect(extractMissingPackage(output, "node")).toBeNull();
    });

    it("returns null when no ModuleNotFoundError", () => {
      expect(extractMissingPackage("ZeroDivisionError", "python")).toBeNull();
      expect(extractMissingPackage("42", "python")).toBeNull();
    });

    it("rejects package names with invalid characters", () => {
      const output = "ModuleNotFoundError: No module named 'foo; rm -rf /'";
      expect(extractMissingPackage(output, "python")).toBeNull();
    });

    it("extracts Node.js package from Cannot find module", () => {
      const output = "Error: Cannot find module 'lodash'\nRequire stack:\n- <repl>";
      expect(extractMissingPackage(output, "node")).toBe("lodash");
    });

    it("extracts scoped Node.js packages", () => {
      const output = "Error: Cannot find module '@anthropic-ai/sdk'";
      expect(extractMissingPackage(output, "node")).toBe("@anthropic-ai/sdk");
    });

    it("strips subpath from Node.js package", () => {
      const output = "Error: Cannot find module 'csv-stringify/sync'";
      expect(extractMissingPackage(output, "node")).toBe("csv-stringify");
    });

    it("skips relative paths for Node.js", () => {
      expect(extractMissingPackage("Cannot find module './utils'", "node")).toBeNull();
      expect(extractMissingPackage("Cannot find module '/abs/path'", "node")).toBeNull();
    });

    it("rejects invalid Node.js package names", () => {
      const output = "Cannot find module 'foo; rm -rf /'";
      expect(extractMissingPackage(output, "node")).toBeNull();
    });

    it("extracts dotted Node.js package names like socket.io", () => {
      const output = "Error: Cannot find module 'socket.io'";
      expect(extractMissingPackage(output, "node")).toBe("socket.io");
    });

    it("extracts dotted package with subpath stripped", () => {
      const output = "Error: Cannot find module 'socket.io/client-dist'";
      expect(extractMissingPackage(output, "node")).toBe("socket.io");
    });
  });

  describe("missing dependency execution", () => {
    const packageManagerExec = vi.mocked(execFile);

    it("returns Python missing-package output and hint without installing or retrying", async () => {
      const missingPackage = "nonexistent_pkg_xyzzy_99999";
      const result = await runCodeExec({
        code: `import ${missingPackage}`,
        language: "python",
        reset: true,
      });

      expect(result.content).toContain("ModuleNotFoundError");
      expect(result.content).toContain(missingPackage);
      expect(result.content).toContain(
        `Tip: Install the missing package with shell: pip install ${missingPackage}`,
      );
      expect(result.content).not.toContain("Auto-installed");
      expect(packageManagerExec).not.toHaveBeenCalled();
    });

    it("returns Node missing-package output and pnpm hint without installing or retrying", async () => {
      const missingPackage = "nonexistent-node-pkg-kota-xyzzy-99999";
      const result = await runCodeExec({
        code: `require("${missingPackage}")`,
        language: "node",
        reset: true,
      });

      expect(result.content).toContain("Cannot find module");
      expect(result.content).toContain(missingPackage);
      expect(result.content).toContain(
        `Tip: Install the missing package with shell: pnpm add ${missingPackage}`,
      );
      expect(result.content).not.toContain("Auto-installed");
      expect(packageManagerExec).not.toHaveBeenCalled();
    });

    it("no hint when code succeeds (stdlib import)", async () => {
      const result = await runCodeExec({
        code: "import json; json.dumps({'ok': True})",
        language: "python",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).not.toContain("Tip:");
      expect(result.content).not.toContain("Auto-installed");
    });
  });

  describe("timeout handling", () => {
    it("python: SIGINT interrupts and preserves session state", async () => {
      // Set up state
      await runCodeExec({ code: "x = 42", language: "python" });
      // time.sleep is interruptible by SIGINT
      const result = await runCodeExec({
        code: "import time; time.sleep(60)",
        language: "python",
        timeout_ms: 1000,
      });
      expect(result.is_error).toBe(false);
      expect(result.content).toContain("interrupted");
      expect(result.content).toContain("state preserved");
      // State should survive the interrupt
      const check = await runCodeExec({ code: "x", language: "python" });
      expect(check.content).toContain("42");
    }, 15000);

    it("python: recovers after interrupt", async () => {
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
    }, 15000);

    it("node: timeout kills session with recovery guidance", async () => {
      const result = await runCodeExec({
        code: "while(true){}",
        language: "node",
        timeout_ms: 500,
      });
      expect(result.is_error).toBe(true);
      expect(result.content).toContain("timed out");
      expect(result.content).toContain("re-import");
      expect(result.content).toContain("timeout_ms");
    }, 10000);

    it("node: recovers after timeout", async () => {
      await runCodeExec({
        code: "while(true){}",
        language: "node",
        timeout_ms: 500,
      });
      const result = await runCodeExec({
        code: "1 + 1",
        language: "node",
      });
      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("2");
    }, 10000);
  });

  describe("venv-aware package hints (cross-module: repl-session x code-exec)", () => {
    it("detectPackageHint uses venv binary in install command", () => {
      const output = "ModuleNotFoundError: No module named 'pandas'";
      const venvBin = "/project/.venv/bin/python";
      expect(detectPackageHint(output, "python", venvBin)).toBe(
        "Tip: Install the missing package with shell: /project/.venv/bin/python -m pip install pandas",
      );
    });

    it("detectPackageHint falls back to pip for system python3", () => {
      const output = "ModuleNotFoundError: No module named 'numpy'";
      expect(detectPackageHint(output, "python", "python3")).toBe(
        "Tip: Install the missing package with shell: pip install numpy",
      );
    });

    it("detectPackageHint defaults to standard pip without binary arg", () => {
      const output = "ModuleNotFoundError: No module named 'flask'";
      expect(detectPackageHint(output, "python")).toBe(
        "Tip: Install the missing package with shell: pip install flask",
      );
    });

    it("findPythonBinary result flows into detectPackageHint for non-venv path", async () => {
      // Cross-module: findPythonBinary from repl-session feeds into detectPackageHint
      const { findPythonBinary } = await import("#modules/execution/repl-session.js");
      const bin = findPythonBinary("/nonexistent/path/no/venv/here");
      const output = "ModuleNotFoundError: No module named 'requests'";
      const hint = detectPackageHint(output, "python", bin);
      // No venv exists → falls back to python3 → standard pip command
      expect(hint).toBe("Tip: Install the missing package with shell: pip install requests");
    });

    it("node hint unchanged by python binary", () => {
      const output = "Error: Cannot find module 'express'";
      expect(detectPackageHint(output, "node", "/some/.venv/bin/python")).toBe(
        "Tip: Install the missing package with shell: pnpm add express",
      );
    });
  });
});
