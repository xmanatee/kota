import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { AnswerResult } from "#core/server/kota-client.js";
import { registerAnswerCommand } from "./cli.js";

type AnswerOverride = (
  query: string,
  filter?: { topK?: number; minScore?: number; sources?: ReadonlyArray<string> },
) => Promise<AnswerResult>;

function stubCtx(handler: AnswerOverride): ModuleContext {
  return {
    client: {
      answer: {
        async answer(query: string, filter?: { topK?: number; minScore?: number; sources?: ReadonlyArray<string> }) {
          return handler(query, filter);
        },
      },
    },
  } as unknown as ModuleContext;
}

function makeProgram(handler: AnswerOverride): Command {
  const program = new Command();
  program.exitOverride();
  registerAnswerCommand(program, stubCtx(handler));
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

const sampleResult: AnswerResult = {
  ok: true,
  answer:
    "Recall ranks results across stores [knowledge:k1] and the work landed under [tasks:task-recall-seam].",
  citations: [
    { source: "knowledge", id: "k1" },
    { source: "tasks", id: "task-recall-seam" },
  ],
  hits: [
    {
      source: "knowledge",
      score: 1,
      id: "k1",
      title: "Recall design",
      preview: "...",
      updated: "2026-04-26",
    },
    {
      source: "tasks",
      score: 0.5,
      id: "task-recall-seam",
      title: "Add recall seam",
      state: "done",
      priority: "p1",
      updatedAt: "2026-04-27",
    },
  ],
};

describe("kota answer", () => {
  let captured: { query?: string; filter?: unknown } = {};

  beforeEach(() => {
    captured = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the synthesized answer and a typed citation list", async () => {
    const program = makeProgram(async (query, filter) => {
      captured = { query, filter };
      return sampleResult;
    });
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "answer", "How does recall work?"]);
    });
    expect(captured.query).toBe("How does recall work?");
    expect(output).toContain("[knowledge:k1]");
    expect(output).toContain("[tasks:task-recall-seam]");
    expect(output).toContain("Citations");
    expect(output).toContain("knowledge");
    expect(output).toContain("Recall design");
    expect(output).toContain("Add recall seam");
  });

  it("emits the structured payload for --json", async () => {
    const program = makeProgram(async () => sampleResult);
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "answer", "q", "--json"]);
    });
    const parsed = JSON.parse(output.trim()) as AnswerResult;
    expect(parsed).toEqual(sampleResult);
  });

  it("rendered output and --json reference the same citation ids (parity)", async () => {
    const program = makeProgram(async () => sampleResult);
    const renderedOutput = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "answer", "x"]);
    });
    const program2 = makeProgram(async () => sampleResult);
    const jsonOutput = await captureStdout(async () => {
      await program2.parseAsync(["node", "kota", "answer", "x", "--json"]);
    });
    const parsed = JSON.parse(jsonOutput.trim()) as AnswerResult;
    if (!parsed.ok) throw new Error("Expected ok:true result");
    for (const c of parsed.citations) {
      expect(renderedOutput).toContain(c.id);
      expect(renderedOutput).toContain(c.source);
    }
  });

  it("forwards --limit, --source, and --min-score into the answer filter", async () => {
    const program = makeProgram(async (_q, filter) => {
      captured.filter = filter;
      return { ok: false, reason: "no_hits" };
    });
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      await program.parseAsync([
        "node",
        "kota",
        "answer",
        "x",
        "--limit",
        "3",
        "--source",
        "knowledge",
        "--source",
        "tasks",
        "--min-score",
        "0.4",
      ]);
    } catch {
      /* expected exit */
    }
    expect(captured.filter).toEqual({
      topK: 3,
      sources: ["knowledge", "tasks"],
      minScore: 0.4,
    });
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("exits non-zero with a no_hits message", async () => {
    const program = makeProgram(async () => ({ ok: false, reason: "no_hits" }));
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
      await program.parseAsync(["node", "kota", "answer", "anything"]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("No matching sources");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("exits non-zero with a semantic_unavailable message", async () => {
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
    try {
      await program.parseAsync(["node", "kota", "answer", "anything"]);
    } catch {
      /* expected exit */
    }
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("Cross-store recall has no registered contributors");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("exits non-zero with a synthesis_failed message", async () => {
    const program = makeProgram(async () => ({
      ok: false,
      reason: "synthesis_failed",
    }));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    try {
      await program.parseAsync(["node", "kota", "answer", "anything"]);
    } catch {
      /* expected exit */
    }
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("Synthesis failed");
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
