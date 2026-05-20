import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShell } from "./shell.js";

// Suppress stderr output during tests
let stderrSpy: ReturnType<typeof vi.spyOn>;
const envKeys = [
  "KOTA_SESSION_ID",
  "KOTA_TOOL_USE_ID",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_ENDPOINT",
] as const;
let savedEnv: Partial<Record<(typeof envKeys)[number], string>>;

beforeEach(() => {
  savedEnv = {};
  for (const key of envKeys) savedEnv[key] = process.env[key];
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  for (const key of envKeys) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  stderrSpy.mockRestore();
});

const envProbeCommand =
  "printf '%s|%s|%s|%s' " +
  "\"${KOTA_SESSION_ID-missing}\" " +
  "\"${KOTA_TOOL_USE_ID-missing}\" " +
  "\"${OTEL_EXPORTER_OTLP_ENDPOINT-missing}\" " +
  "\"${OTLP_ENDPOINT-missing}\"";

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

  it("injects context ids and scrubs inherited telemetry routing env", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://kota-collector";
    process.env.OTLP_ENDPOINT = "http://legacy-collector";

    const result = await runShell(
      { command: envProbeCommand, stream_output: false },
      { sessionId: "session-123", toolUseId: "tool-456" },
    );

    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("session-123|tool-456|missing|missing");
  });

  it("does not synthesize correlation ids for no-context direct calls", async () => {
    process.env.KOTA_SESSION_ID = "parent-session";
    process.env.KOTA_TOOL_USE_ID = "parent-tool";

    const result = await runShell({
      command: envProbeCommand,
      stream_output: false,
    });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toBe("missing|missing|missing|missing");
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
