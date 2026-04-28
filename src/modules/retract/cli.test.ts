import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  RetractRequest,
  RetractResult,
} from "#core/server/kota-client.js";
import { registerRetractCommand } from "./cli.js";

vi.mock("#core/modules/cli-providers.js", () => ({
  ensureCliProvidersFor: vi.fn(async () => {}),
}));

type RetractOverride = (request: RetractRequest) => Promise<RetractResult>;

function stubCtx(handler: RetractOverride): ModuleContext {
  return {
    client: {
      retract: {
        async retract(request: RetractRequest) {
          return handler(request);
        },
      },
    },
  } as unknown as ModuleContext;
}

function makeProgram(handler: RetractOverride): Command {
  const program = new Command();
  program.exitOverride();
  registerRetractCommand(program, stubCtx(handler));
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

describe("kota retract", () => {
  let captured: { request?: RetractRequest } = {};

  beforeEach(() => {
    captured = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retracts a memory entry by id and renders the typed record", async () => {
    const program = makeProgram(async (request) => {
      captured = { request };
      return { ok: true, record: { target: "memory", recordId: "mem-7" } };
    });
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "retract",
        "--target",
        "memory",
        "--id",
        "mem-7",
      ]);
    });
    expect(captured.request).toEqual({ target: "memory", id: "mem-7" });
    expect(output).toContain("memory  mem-7");
  });

  it("retracts a knowledge entry by slug", async () => {
    const program = makeProgram(async (request) => {
      captured = { request };
      return {
        ok: true,
        record: { target: "knowledge", recordId: "discriminated-unions" },
      };
    });
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "retract",
        "--target",
        "knowledge",
        "--slug",
        "discriminated-unions",
      ]);
    });
    expect(captured.request).toEqual({
      target: "knowledge",
      slug: "discriminated-unions",
    });
    expect(output).toContain("knowledge  discriminated-unions");
  });

  it("retracts a task and renders moved-to-dropped semantics", async () => {
    const program = makeProgram(async () => ({
      ok: true,
      record: {
        target: "tasks",
        recordId: "task-x",
        previousPath: "data/tasks/backlog/task-x.md",
        path: "data/tasks/dropped/task-x.md",
        toState: "dropped",
      },
    }));
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "retract",
        "--target",
        "tasks",
        "--id",
        "task-x",
      ]);
    });
    expect(output).toContain(
      "tasks  task-x  data/tasks/backlog/task-x.md -> data/tasks/dropped/task-x.md (dropped)",
    );
  });

  it("retracts an inbox file by repo-relative path", async () => {
    const program = makeProgram(async () => ({
      ok: true,
      record: {
        target: "inbox",
        recordId: "note-x",
        path: "data/inbox/note-x.md",
      },
    }));
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "retract",
        "--target",
        "inbox",
        "--path",
        "data/inbox/note-x.md",
      ]);
    });
    expect(output).toContain("inbox  note-x  data/inbox/note-x.md");
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
        "retract",
        "--json",
        "--target",
        "memory",
        "--id",
        "mem-1",
      ]);
    });
    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual({
      ok: true,
      record: { target: "memory", recordId: "mem-1" },
    });
  });

  it("renders not_found on the unknown-id arm", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "not_found",
      target: "memory",
      identifier: "missing-mem",
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
        "retract",
        "--target",
        "memory",
        "--id",
        "missing-mem",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain('Retract memory: no record with identifier "missing-mem"');
  });

  it("renders no_contributors when the seam is unconfigured for the named target", async () => {
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
      await program.parseAsync([
        "node",
        "kota",
        "retract",
        "--target",
        "memory",
        "--id",
        "anything",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain(
      "Cross-store retract has no registered contributors",
    );
  });

  it("renders contributor_failed on the writer-throw arm", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "contributor_failed",
      target: "inbox",
      message: "disk read-only",
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
        "retract",
        "--target",
        "inbox",
        "--path",
        "data/inbox/note-x.md",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("Retract from inbox failed: disk read-only");
  });

  it("rejects ambiguous identifier combinations at parse time", async () => {
    const program = makeProgram(async () => {
      throw new Error("provider should not be called");
    });
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
        "retract",
        "--target",
        "memory",
        "--slug",
        "k-slug",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("memory retract takes --id only");
  });

  it("rejects missing identifier at parse time", async () => {
    const program = makeProgram(async () => {
      throw new Error("provider should not be called");
    });
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
        "retract",
        "--target",
        "tasks",
      ]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("tasks retract requires --id");
  });
});
