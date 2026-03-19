import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as confirm from "../confirm.js";
import { runShell } from "./shell.js";

// Suppress stderr output during tests
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe("shell: input validation", () => {
  it("returns error when command is empty", async () => {
    const result = await runShell({ command: "" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("command is required");
  });

  it("returns error when command is undefined", async () => {
    const result = await runShell({});
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("command is required");
  });
});

describe("shell: successful commands", () => {
  it("runs echo and returns output", async () => {
    const result = await runShell({ command: "echo hello" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("hello");
  });

  it("returns (no output) for silent commands", async () => {
    const result = await runShell({ command: "true" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("(no output)");
  });

  it("captures both stdout and stderr", async () => {
    const result = await runShell({ command: "echo out && echo err >&2" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("out");
    expect(result.content).toContain("err");
  });

  it("handles multi-line output", async () => {
    const result = await runShell({ command: "printf 'a\\nb\\nc'" });
    expect(result.content).toBe("a\nb\nc");
  });

  it("can capture output without streaming it to stderr", async () => {
    const result = await runShell({
      command: "echo quiet",
      stream_output: false,
    });
    expect(result.content).toBe("quiet");
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("shell: error handling", () => {
  it("returns error for non-zero exit code", async () => {
    const result = await runShell({ command: "exit 1" });
    expect(result.is_error).toBe(true);
  });

  it("returns error for command not found", async () => {
    const result = await runShell({ command: "nonexistent_command_xyz_12345" });
    expect(result.is_error).toBe(true);
  });

  it("includes output in error for failed commands", async () => {
    const result = await runShell({ command: "echo 'some output' && exit 1" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("some output");
  });
});

describe("shell: timeout", () => {
  it("kills command after timeout", async () => {
    const result = await runShell({ command: "sleep 60", timeout_ms: 200 });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("timed out");
  }, 10_000);

  it("uses default timeout of 120s if not specified", async () => {
    // Just verify it doesn't fail for a quick command
    const result = await runShell({ command: "echo fast" });
    expect(result.content).toBe("fast");
  });
});

describe("shell: working directory (cwd)", () => {
  it("runs command in specified directory", async () => {
    const result = await runShell({ command: "pwd", cwd: "/tmp" });
    expect(result.is_error).toBeUndefined();
    // /tmp may resolve to /private/tmp on macOS
    expect(result.content).toMatch(/\/?tmp$/);
  });

  it("returns error for non-existent directory", async () => {
    const result = await runShell({ command: "pwd", cwd: "/nonexistent_dir_xyz" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("working directory not found");
    expect(result.content).toContain("/nonexistent_dir_xyz");
  });

  it("uses current directory when cwd not specified", async () => {
    const result = await runShell({ command: "pwd" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe(process.cwd());
  });

  it("accesses files relative to cwd", async () => {
    // /tmp should exist and be listable
    const result = await runShell({ command: "ls -d .", cwd: "/tmp" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe(".");
  });
});

describe("shell: output truncation", () => {
  it("truncates output exceeding 20K chars", async () => {
    // Generate >20K chars of output
    const result = await runShell({
      command: "python3 -c \"print('x' * 25000)\"",
    });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("truncated");
    // Should keep first 10K and last 5K
    expect(result.content!.length).toBeLessThan(25000);
  });

  it("does not truncate output under 20K chars", async () => {
    const result = await runShell({ command: "echo short" });
    expect(result.content).not.toContain("truncated");
  });
});

describe("shell: dangerous command confirmation", () => {
  it("blocks dangerous command when user declines", async () => {
    vi.spyOn(confirm, "isDangerous").mockReturnValue(true);
    vi.spyOn(confirm, "confirmExecution").mockResolvedValue(false);

    const result = await runShell({ command: "rm -rf /" });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("blocked");
    expect(result.content).toContain("declined");

    vi.restoreAllMocks();
    // Re-setup stderr spy after restoreAllMocks
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  it("allows dangerous command when user confirms", async () => {
    vi.spyOn(confirm, "isDangerous").mockReturnValue(true);
    vi.spyOn(confirm, "confirmExecution").mockResolvedValue(true);

    const result = await runShell({ command: "echo safe-actually" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("safe-actually");

    vi.restoreAllMocks();
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
});
