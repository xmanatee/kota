import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  AnswerHistoryListFilter,
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerHistoryShowResult,
  AnswerResult,
} from "#core/server/kota-client.js";
import { registerAnswerCommand } from "./cli.js";

type AnswerOverride = (
  query: string,
  filter?: { topK?: number; minScore?: number; sources?: ReadonlyArray<string> },
) => Promise<AnswerResult>;

type HistoryOverrides = {
  log?: (filter?: AnswerHistoryListFilter) => Promise<AnswerHistoryListResult>;
  show?: (id: string) => Promise<AnswerHistoryShowResult>;
};

function stubCtx(
  handler: AnswerOverride,
  history?: HistoryOverrides,
): ModuleContext {
  return {
    client: {
      answer: {
        async answer(query: string, filter?: { topK?: number; minScore?: number; sources?: ReadonlyArray<string> }) {
          return handler(query, filter);
        },
        async log(filter?: AnswerHistoryListFilter) {
          if (!history?.log) return { entries: [] };
          return history.log(filter);
        },
        async show(id: string) {
          if (!history?.show) return { ok: false, reason: "not_found" };
          return history.show(id);
        },
      },
    },
  } as unknown as ModuleContext;
}

function makeProgram(
  handler: AnswerOverride,
  history?: HistoryOverrides,
): Command {
  const program = new Command();
  program.exitOverride();
  registerAnswerCommand(program, stubCtx(handler, history));
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

const okEntry = (i: number) => ({
  id: `2026-04-28T00-00-0${i}-000Z-${String(i).padStart(6, "0")}`,
  createdAt: `2026-04-28T00:00:0${i}.000Z`,
  query: `q${i}`,
  result: { ok: true as const, citationCount: 2 },
});

const failEntry = (i: number) => ({
  id: `2026-04-28T00-00-0${i}-000Z-${String(i).padStart(6, "0")}`,
  createdAt: `2026-04-28T00:00:0${i}.000Z`,
  query: `q${i}`,
  result: {
    ok: false as const,
    reason: "no_hits" as const,
  },
});

const okRecord = (id: string): AnswerHistoryRecord => ({
  id,
  createdAt: "2026-04-28T00:00:00.000Z",
  query: "How does recall work?",
  filter: { topK: 8 },
  recallHits: [
    {
      source: "knowledge",
      score: 1,
      id: "k1",
      title: "Recall design",
      preview: "...",
      updated: "2026-04-26",
    },
  ],
  result: {
    ok: true,
    answer: "Recall ranks across stores [knowledge:k1].",
    citations: [{ source: "knowledge", id: "k1" }],
    hits: [
      {
        source: "knowledge",
        score: 1,
        id: "k1",
        title: "Recall design",
        preview: "...",
        updated: "2026-04-26",
      },
    ],
  },
});

const failRecord = (id: string): AnswerHistoryRecord => ({
  id,
  createdAt: "2026-04-28T00:00:00.000Z",
  query: "What about nothing?",
  filter: { topK: 8 },
  recallHits: [],
  result: { ok: false, reason: "no_hits" },
});

describe("kota answer log", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an empty-store hint", async () => {
    const program = makeProgram(async () => sampleResult, {
      log: async () => ({ entries: [] }),
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await program.parseAsync(["node", "kota", "answer", "log"]);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("No persisted answer records yet");
    stderrSpy.mockRestore();
  });

  it("renders mixed ok and ok=false rows", async () => {
    const program = makeProgram(async () => sampleResult, {
      log: async () => ({ entries: [okEntry(2), failEntry(1), okEntry(0)] }),
    });
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "answer", "log"]);
    });
    expect(output).toContain("q2");
    expect(output).toContain("q1");
    expect(output).toContain("q0");
    expect(output).toContain("ok(2)");
    expect(output).toContain("no_hits");
  });

  it("emits the structured payload for --json", async () => {
    const program = makeProgram(async () => sampleResult, {
      log: async () => ({ entries: [okEntry(0)] }),
    });
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "answer", "log", "--json"]);
    });
    const parsed = JSON.parse(output.trim()) as AnswerHistoryListResult;
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].id).toBe(okEntry(0).id);
  });

  it("forwards --limit and --before through to the client", async () => {
    let captured: AnswerHistoryListFilter | undefined;
    const program = makeProgram(async () => sampleResult, {
      log: async (filter) => {
        captured = filter;
        return { entries: [] };
      },
    });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    await program.parseAsync([
      "node",
      "kota",
      "answer",
      "log",
      "--limit",
      "5",
      "--before",
      "abc",
    ]);
    expect(captured).toEqual({ limit: 5, beforeId: "abc" });
    stderrSpy.mockRestore();
  });
});

describe("kota answer show", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-renders an ok:true record body and citations", async () => {
    const record = okRecord("rec-1");
    const program = makeProgram(async () => sampleResult, {
      show: async (id) =>
        id === record.id ? { ok: true, record } : { ok: false, reason: "not_found" },
    });
    const output = await captureStdout(async () => {
      await program.parseAsync(["node", "kota", "answer", "show", record.id]);
    });
    expect(output).toContain("[knowledge:k1]");
    expect(output).toContain("Citations");
    expect(output).toContain("Recall design");
  });

  it("renders the failure reason for an ok:false record without a synthesized body", async () => {
    const record = failRecord("rec-2");
    const program = makeProgram(async () => sampleResult, {
      show: async () => ({ ok: true, record }),
    });
    const output = await captureStdout(async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);
      try {
        await program.parseAsync(["node", "kota", "answer", "show", "rec-2"]);
      } finally {
        const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(stderr).toContain("No matching sources");
        stderrSpy.mockRestore();
      }
    });
    expect(output).toContain(record.query);
    expect(output).not.toContain("Citations");
  });

  it("exits non-zero when the record id is not found", async () => {
    const program = makeProgram(async () => sampleResult, {
      show: async () => ({ ok: false, reason: "not_found" }),
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
      await program.parseAsync(["node", "kota", "answer", "show", "missing"]);
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toBe("process.exit:1");
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain('No answer record found for id "missing"');
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("emits the structured AnswerHistoryShowResult for --json", async () => {
    const record = okRecord("rec-3");
    const program = makeProgram(async () => sampleResult, {
      show: async () => ({ ok: true, record }),
    });
    const output = await captureStdout(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "answer",
        "show",
        record.id,
        "--json",
      ]);
    });
    const parsed = JSON.parse(output.trim()) as AnswerHistoryShowResult;
    if (!parsed.ok) throw new Error("expected ok:true");
    expect(parsed.record.id).toBe(record.id);
  });
});
