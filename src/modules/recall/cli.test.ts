import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerRecallCommand } from "./cli.js";
import type { RecallHit, RecallResult } from "./client.js";

type RecallOverride = (
  query: string,
  filter?: { topK?: number; minScore?: number; sources?: ReadonlyArray<string> },
) => Promise<RecallResult>;

function stubCtx(handler: RecallOverride): ModuleContext {
  return {
    client: {
      recall: {
        async recall(query: string, filter?: { topK?: number; minScore?: number; sources?: ReadonlyArray<string> }) {
          return handler(query, filter);
        },
      },
    },
  } as unknown as ModuleContext;
}

function makeProgram(handler: RecallOverride): Command {
  const program = new Command();
  program.exitOverride();
  registerRecallCommand(program, stubCtx(handler));
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

const sampleHits: RecallHit[] = [
  {
    source: "knowledge",
    score: 1,
    id: "k1",
    title: "Recall design",
    preview: "...",
    updated: "2026-04-26",
  },
  {
    source: "memory",
    score: 0.7,
    id: "m1",
    preview: "captured note",
    created: "2026-04-25",
  },
  {
    source: "tasks",
    score: 0.5,
    id: "task-recall-seam",
    title: "Add recall seam",
    state: "doing",
    priority: "p2",
    updatedAt: "2026-04-27",
  },
];

describe("kota recall", () => {
  let captured: { query?: string; filter?: unknown } = {};

  beforeEach(() => {
    captured = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints rendered hits with source, score, id, and title", async () => {
    const program = makeProgram(async (query, filter) => {
      captured = { query, filter };
      return { ok: true, hits: sampleHits };
    });
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "recall", "graphrag"]);
    });
    expect(captured.query).toBe("graphrag");
    expect(output).toContain("knowledge");
    expect(output).toContain("memory");
    expect(output).toContain("tasks");
    expect(output).toContain("k1");
    expect(output).toContain("m1");
    expect(output).toContain("task-recall-seam");
    expect(output).toContain("Recall design");
    expect(output).toContain("Add recall seam");
  });

  it("emits the structured payload for --json", async () => {
    const program = makeProgram(async () => ({ ok: true, hits: sampleHits }));
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "recall", "graphrag", "--json"]);
    });
    const parsed = JSON.parse(output.trim());
    expect(parsed).toEqual({ ok: true, hits: sampleHits });
  });

  it("forwards --limit and --source into the recall filter", async () => {
    const program = makeProgram(async (_query, filter) => {
      captured.filter = filter;
      return { ok: true, hits: [] };
    });
    await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "recall",
        "x",
        "--limit",
        "5",
        "--source",
        "knowledge",
        "--source",
        "tasks",
      ]);
    });
    expect(captured.filter).toEqual({ topK: 5, sources: ["knowledge", "tasks"] });
  });

  it("forwards --min-score into the filter", async () => {
    const program = makeProgram(async (_query, filter) => {
      captured.filter = filter;
      return { ok: true, hits: [] };
    });
    await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "recall",
        "x",
        "--min-score",
        "0.6",
      ]);
    });
    expect(captured.filter).toMatchObject({ minScore: 0.6 });
  });

  it("prints 'No matching hits.' when result is empty", async () => {
    const program = makeProgram(async () => ({ ok: true, hits: [] }));
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "recall", "nothing"]);
    });
    expect(output).toContain("No matching hits.");
  });

  it("exits non-zero with a contributor message when the seam is unavailable", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "semantic_unavailable",
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
      await program.parseAsync(["node", "kota", "recall", "anything"]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain(
      "Cross-store recall has no registered contributors.",
    );
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("--json emits the same hit set as the rendered table (parity)", async () => {
    const program = makeProgram(async () => ({ ok: true, hits: sampleHits }));
    const renderedOutput = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "recall", "x"]);
    });
    const program2 = makeProgram(async () => ({ ok: true, hits: sampleHits }));
    const jsonOutput = await captureStdout(async () => {
      await program2.parseAsync(["node", "kota", "recall", "x", "--json"]);
    });
    const parsed = JSON.parse(jsonOutput.trim()) as RecallResult;
    if (!parsed.ok) throw new Error("Expected ok:true result");
    for (const hit of parsed.hits) {
      expect(renderedOutput).toContain(hit.id);
      expect(renderedOutput).toContain(hit.source);
    }
  });
});
