import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerCaptureCommand } from "./cli.js";
import type { CaptureFilter, CaptureResult } from "./client.js";

vi.mock("#core/modules/cli-providers.js", () => ({
  ensureCliProvidersFor: vi.fn(async () => {}),
}));

type CaptureOverride = (
  text: string,
  filter?: CaptureFilter,
) => Promise<CaptureResult>;

function stubCtx(handler: CaptureOverride): ModuleContext {
  return {
    client: {
      capture: {
        async capture(text: string, filter?: CaptureFilter) {
          return handler(text, filter);
        },
      },
    },
  } as unknown as ModuleContext;
}

function makeProgram(handler: CaptureOverride): Command {
  const program = new Command();
  program.exitOverride();
  registerCaptureCommand(program, stubCtx(handler));
  return program;
}

async function captureStdout(fn: () => void | Promise<void>): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    lines.push(String(data));
    return true;
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    lines.push(`${args.join(" ")}\n`);
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
    logSpy.mockRestore();
  }
  return lines.join("");
}

describe("kota capture", () => {
  let captured: { text?: string; filter?: CaptureFilter | undefined } = {};

  beforeEach(() => {
    captured = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the typed memory record on a memory capture", async () => {
    const program = makeProgram(async (text, filter) => {
      captured = { text, filter };
      return { ok: true, record: { target: "memory", recordId: "mem-7" } };
    });
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "remember",
        "that",
        "I",
        "prefer",
        "dark",
        "themes",
      ]);
    });
    expect(captured.text).toBe("remember that I prefer dark themes");
    expect(captured.filter).toBeUndefined();
    expect(output).toContain("memory  mem-7");
  });

  it("forwards --target to the seam (knowledge case)", async () => {
    const program = makeProgram(async (_text, filter) => {
      captured.filter = filter;
      return {
        ok: true,
        record: { target: "knowledge", recordId: "discriminated-unions" },
      };
    });
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "--target",
        "knowledge",
        "typescript discriminated unions are exhaustive in switch with no default",
      ]);
    });
    expect(captured.filter).toEqual({ target: "knowledge" });
    expect(output).toContain("knowledge  discriminated-unions");
  });

  it("renders the typed task record path on a tasks capture", async () => {
    const program = makeProgram(async (_text, filter) => {
      captured.filter = filter;
      return {
        ok: true,
        record: {
          target: "tasks",
          recordId: "task-review-macos-push-permissions",
          path: "data/tasks/backlog/task-review-macos-push-permissions.md",
        },
      };
    });
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "--target",
        "tasks",
        "review macOS push permissions before next release",
      ]);
    });
    expect(captured.filter).toEqual({ target: "tasks" });
    expect(output).toContain("tasks  task-review-macos-push-permissions");
    expect(output).toContain(
      "data/tasks/backlog/task-review-macos-push-permissions.md",
    );
  });

  it("renders the typed inbox record path on an inbox capture", async () => {
    const program = makeProgram(async () => ({
      ok: true,
      record: {
        target: "inbox",
        recordId: "note-raw-thought-worth-filing",
        path: "data/inbox/note-raw-thought-worth-filing.md",
      },
    }));
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "--target",
        "inbox",
        "raw thought worth filing",
      ]);
    });
    expect(output).toContain("inbox  note-raw-thought-worth-filing");
  });

  it("emits the structured envelope on --json", async () => {
    const program = makeProgram(async () => ({
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    }));
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "--json",
        "anything",
      ]);
    });
    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual({
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    });
  });

  it("renders ambiguous suggestions on the unguided ambiguous arm", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "ambiguous",
      suggestions: ["memory", "knowledge", "tasks", "inbox"],
    }));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let thrown: Error | null = null;
    try {
      await program.parseAsync(["node", "kota", "capture", "ambiguous note"]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("Ambiguous capture");
    expect(stderr).toContain("memory, knowledge, tasks, inbox");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("renders contributor_failed on the writer-throw arm", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk full",
    }));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let thrown: Error | null = null;
    try {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "--target",
        "inbox",
        "anything",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("Capture into inbox failed: disk full");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("renders no_contributors when the seam is unconfigured", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "no_contributors",
    }));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    let thrown: Error | null = null;
    try {
      await program.parseAsync(["node", "kota", "capture", "anything"]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain(
      "Cross-store capture has no registered contributors.",
    );
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("--json emits the typed envelope and exits non-zero on failure", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "ambiguous",
      suggestions: ["memory", "tasks"],
    }));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    let thrown: Error | null = null;
    let captured = "";
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((data) => {
        captured += String(data);
        return true;
      });
    try {
      await program.parseAsync([
        "node",
        "kota",
        "capture",
        "--json",
        "ambiguous note",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const parsed = JSON.parse(captured.trim());
    expect(parsed).toEqual({
      ok: false,
      reason: "ambiguous",
      suggestions: ["memory", "tasks"],
    });
    exitSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
