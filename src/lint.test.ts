import * as cp from "node:child_process";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lintFile } from "./lint.js";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, readFileSync: vi.fn() };
});

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execSync: vi.fn() };
});

const mockReadFile = fs.readFileSync as ReturnType<typeof vi.fn>;
const mockExec = cp.execSync as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockReadFile.mockReset();
  mockExec.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Extension routing ---

describe("lintFile routing", () => {
  it("returns ok for unknown extensions without calling any linter", () => {
    const result = lintFile("/tmp/readme.md");
    expect(result).toEqual({ ok: true });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("routes .json to JSON parser", () => {
    mockReadFile.mockReturnValue('{"valid": true}');
    const result = lintFile("/tmp/test.json");
    expect(result.ok).toBe(true);
    expect(mockReadFile).toHaveBeenCalledWith("/tmp/test.json", "utf-8");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("routes .js to node --check", () => {
    mockExec.mockReturnValue("");
    const result = lintFile("/tmp/test.js");
    expect(result.ok).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      'node --check "/tmp/test.js"',
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it("routes .cjs and .mjs to node --check", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/test.cjs");
    lintFile("/tmp/test.mjs");
    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec).toHaveBeenCalledWith(
      'node --check "/tmp/test.cjs"',
      expect.anything(),
    );
    expect(mockExec).toHaveBeenCalledWith(
      'node --check "/tmp/test.mjs"',
      expect.anything(),
    );
  });

  it("routes .ts, .tsx, .jsx, .mts, .cts to esbuild", () => {
    mockExec.mockReturnValue("");
    for (const ext of [".ts", ".tsx", ".jsx", ".mts", ".cts"]) {
      lintFile(`/tmp/test${ext}`);
    }
    expect(mockExec).toHaveBeenCalledTimes(5);
  });

  it("routes .py to python3 ast.parse", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/test.py");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("python3"),
      expect.anything(),
    );
  });

  it("handles case-insensitive extensions", () => {
    mockReadFile.mockReturnValue("{}");
    const result = lintFile("/tmp/test.JSON");
    expect(result.ok).toBe(true);
  });
});

// --- JSON linting ---

describe("lintJSON", () => {
  it("passes valid JSON", () => {
    mockReadFile.mockReturnValue('{"key": "value", "num": 42}');
    expect(lintFile("/tmp/good.json")).toEqual({ ok: true });
  });

  it("fails invalid JSON with error message", () => {
    mockReadFile.mockReturnValue("{bad json");
    const result = lintFile("/tmp/bad.json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("JSON");
    }
  });

  it("passes empty object", () => {
    mockReadFile.mockReturnValue("{}");
    expect(lintFile("/tmp/empty.json")).toEqual({ ok: true });
  });

  it("passes valid array", () => {
    mockReadFile.mockReturnValue("[1, 2, 3]");
    expect(lintFile("/tmp/arr.json")).toEqual({ ok: true });
  });
});

// --- JS linting ---

describe("lintJS", () => {
  it("passes when node --check succeeds", () => {
    mockExec.mockReturnValue("");
    expect(lintFile("/tmp/good.js")).toEqual({ ok: true });
  });

  it("fails with stderr when node --check fails", () => {
    const err = new Error("exit code 1") as Error & { stderr: string };
    err.stderr = "/tmp/bad.js:1\nSyntaxError: Unexpected token";
    mockExec.mockImplementation(() => { throw err; });
    const result = lintFile("/tmp/bad.js");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("SyntaxError");
    }
  });

  it("falls back to error.message when no stderr", () => {
    mockExec.mockImplementation(() => { throw new Error("command failed"); });
    const result = lintFile("/tmp/bad2.js");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("command failed");
    }
  });
});

// --- esbuild (TypeScript/JSX) linting ---

describe("lintWithEsbuild", () => {
  it("passes valid TypeScript", () => {
    mockExec.mockReturnValue("");
    expect(lintFile("/tmp/good.ts")).toEqual({ ok: true });
  });

  it("uses tsx loader for .tsx files", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/comp.tsx");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("loader:'tsx'"),
      expect.anything(),
    );
  });

  it("uses tsx loader for .jsx files", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/comp.jsx");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("loader:'tsx'"),
      expect.anything(),
    );
  });

  it("uses ts loader for .ts files", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/mod.ts");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("loader:'ts'"),
      expect.anything(),
    );
  });

  it("uses ts loader for .mts and .cts", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/mod.mts");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("loader:'ts'"),
      expect.anything(),
    );
  });

  it("fails with extracted error on syntax error", () => {
    const err = new Error("exit 1") as Error & { stderr: string };
    err.stderr = [
      "transform failed: 1 error",
      "ERROR: Expected \";\" but found \"}\"",
      " > 3 | const x = }",
      "   |            ^",
    ].join("\n");
    mockExec.mockImplementation(() => { throw err; });
    const result = lintFile("/tmp/bad.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ERROR");
    }
  });

  it("skips gracefully when esbuild MODULE_NOT_FOUND", () => {
    mockExec.mockImplementation(() => {
      throw new Error("Cannot find module 'esbuild'");
    });
    expect(lintFile("/tmp/no-esbuild.ts")).toEqual({ ok: true });
  });

  it("skips gracefully when esbuild MODULE_NOT_FOUND code", () => {
    mockExec.mockImplementation(() => {
      throw new Error("MODULE_NOT_FOUND");
    });
    expect(lintFile("/tmp/no-esbuild2.ts")).toEqual({ ok: true });
  });

  it("handles paths with single quotes", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/it's.ts");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("it'\\''s"),
      expect.anything(),
    );
  });
});

// --- Python linting ---

describe("lintPython", () => {
  it("passes valid Python", () => {
    mockExec.mockReturnValue("");
    expect(lintFile("/tmp/good.py")).toEqual({ ok: true });
  });

  it("fails with stderr on syntax error", () => {
    const err = new Error("exit 1") as Error & { stderr: string };
    err.stderr = "SyntaxError: invalid syntax (test.py, line 3)";
    mockExec.mockImplementation(() => { throw err; });
    const result = lintFile("/tmp/bad.py");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("SyntaxError");
    }
  });

  it("skips when python3 not found (ENOENT)", () => {
    mockExec.mockImplementation(() => {
      throw new Error("spawn python3 ENOENT");
    });
    expect(lintFile("/tmp/no-python.py")).toEqual({ ok: true });
  });

  it("skips when python3 not found (not found message)", () => {
    mockExec.mockImplementation(() => {
      throw new Error("python3: not found");
    });
    expect(lintFile("/tmp/no-python2.py")).toEqual({ ok: true });
  });

  it("handles paths with single quotes", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/it's.py");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("it'\\''s"),
      expect.anything(),
    );
  });
});

// --- Shell (bash) linting ---

describe("lintShell", () => {
  it("routes .sh to bash -n", () => {
    mockExec.mockReturnValue("");
    const result = lintFile("/tmp/deploy.sh");
    expect(result.ok).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      "bash -n '/tmp/deploy.sh'",
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it("routes .bash to bash -n", () => {
    mockExec.mockReturnValue("");
    const result = lintFile("/tmp/setup.bash");
    expect(result.ok).toBe(true);
    expect(mockExec).toHaveBeenCalledWith(
      "bash -n '/tmp/setup.bash'",
      expect.anything(),
    );
  });

  it("fails with stderr on syntax error", () => {
    const err = new Error("exit 1") as Error & { stderr: string };
    err.stderr = "/tmp/bad.sh: line 5: syntax error near unexpected token `fi'";
    mockExec.mockImplementation(() => { throw err; });
    const result = lintFile("/tmp/bad.sh");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("syntax error");
    }
  });

  it("skips when bash not found (ENOENT)", () => {
    mockExec.mockImplementation(() => {
      throw new Error("spawn bash ENOENT");
    });
    expect(lintFile("/tmp/no-bash.sh")).toEqual({ ok: true });
  });

  it("handles paths with single quotes", () => {
    mockExec.mockReturnValue("");
    lintFile("/tmp/it's.sh");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("it'\\''s"),
      expect.anything(),
    );
  });
});

// --- extractEsbuildError (tested indirectly) ---

describe("esbuild error extraction", () => {
  it("extracts ERROR lines from verbose output", () => {
    const err = new Error("exit 1") as Error & { stderr: string };
    err.stderr = [
      "some preamble line",
      "another irrelevant line",
      "ERROR: Unexpected token",
      " > 5 | bad code here",
      "   |   ^^^^^",
      "trailing info",
    ].join("\n");
    mockExec.mockImplementation(() => { throw err; });
    const result = lintFile("/tmp/err.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ERROR: Unexpected token");
      expect(result.error).not.toContain("some preamble");
      expect(result.error).not.toContain("trailing info");
    }
  });

  it("falls back to raw slice when no matching lines", () => {
    const err = new Error("exit 1") as Error & { stderr: string };
    err.stderr = "some generic failure message without markers";
    mockExec.mockImplementation(() => { throw err; });
    const result = lintFile("/tmp/generic.ts");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("some generic failure message without markers");
    }
  });
});
