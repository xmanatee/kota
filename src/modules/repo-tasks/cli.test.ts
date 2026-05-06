import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { renderContext } from "#modules/rendering/render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import { buildTaskListNode, listTasksForStates, registerTaskCommands } from "./cli.js";
import type {
  RepoTaskCreateOptions,
  RepoTaskGcOptions,
  RepoTaskReindexResult,
  RepoTaskSearchFilter,
  RepoTaskSearchResult,
  RepoTaskState,
} from "./client.js";
import { getRepoTasksDir, moveTaskById } from "./repo-tasks-domain.js";
import {
  captureInboxTask,
  createNormalizedTask,
  gcTerminalTasks,
  showTask,
} from "./repo-tasks-operations.js";
import { RepoTasksDefaultStore } from "./repo-tasks-store.js";

const OPEN_STATES: RepoTaskState[] = ["backlog", "ready", "doing", "blocked"];

type SearchOverride = (
  query: string,
  filter?: RepoTaskSearchFilter,
) => Promise<RepoTaskSearchResult>;
type ReindexOverride = () => Promise<RepoTaskReindexResult>;

function stubCtx(
  projectDir: string,
  overrides?: {
    search?: SearchOverride;
    reindex?: ReindexOverride;
  },
): ModuleContext {
  const defaultStore = new RepoTasksDefaultStore(projectDir);
  return {
    cwd: projectDir,
    client: {
      tasks: {
        async list(states?: RepoTaskState[]) {
          const wanted = states && states.length > 0 ? states : OPEN_STATES;
          const tasks = listTasksForStates(getRepoTasksDir(projectDir), wanted);
          return { tasks };
        },
        async show(id: string) {
          return showTask(projectDir, id);
        },
        async move(id: string, toState: RepoTaskState) {
          try {
            const result = moveTaskById(projectDir, id, toState);
            return {
              ok: true as const,
              id: result.id,
              fromState: result.fromState,
              toState: result.toState,
              path: result.path,
              previousPath: result.previousPath,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/not found/i.test(message)) {
              return { ok: false as const, reason: "not_found" as const };
            }
            if (/already in/i.test(message)) {
              return { ok: false as const, reason: "already_in_state" as const, state: toState };
            }
            throw err;
          }
        },
        async create(options: RepoTaskCreateOptions) {
          return createNormalizedTask(projectDir, options);
        },
        async capture(title: string) {
          return captureInboxTask(projectDir, title);
        },
        async gc(options?: RepoTaskGcOptions) {
          return gcTerminalTasks(projectDir, options ?? {});
        },
        async search(query: string, filter?: RepoTaskSearchFilter): Promise<RepoTaskSearchResult> {
          if (overrides?.search) return overrides.search(query, filter);
          // Default: keyword path through the default store. Mirrors the
          // local handler behavior when the operator passes --keyword.
          const opts: { topK: number; states?: RepoTaskState[] } = {
            topK: filter?.limit ?? 20,
          };
          if (filter?.states && filter.states.length > 0) {
            opts.states = [...filter.states];
          }
          const tasks = await defaultStore.searchTasks(query, opts);
          return { ok: true, tasks };
        },
        async reindex(): Promise<RepoTaskReindexResult> {
          if (overrides?.reindex) return overrides.reindex();
          return defaultStore.reindex();
        },
      },
    },
  } as unknown as ModuleContext;
}

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-task-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  // Resolve symlinks (macOS /var -> /private/var) so process.cwd() and tmpdir() agree
  return realpathSync(dir);
}

function writeTaskFile(
  projectDir: string,
  state: string,
  id: string,
  extra: Record<string, string> = {},
): void {
  const dir = join(projectDir, "data", "tasks", state);
  mkdirSync(dir, { recursive: true });
  const fm = {
    id,
    title: `Title for ${id}`,
    status: state,
    priority: "p2",
    area: "test",
    summary: "A test task.",
    created_at: "2026-03-20",
    updated_at: "2026-03-20",
    ...extra,
  };
  const frontmatter = Object.entries(fm)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const content = `---\n${frontmatter}\n---\n\n## Problem\n\nTest.\n\n## Desired Outcome\n\nWorks.\n\n## Constraints\n\nNone.\n\n## Done When\n\n- Done.\n`;
  writeFileSync(join(dir, `${id}.md`), content);
}

async function captureOutput(fn: () => void | Promise<void>): Promise<string> {
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

function makeProgram(
  projectDir?: string,
  overrides?: {
    search?: SearchOverride;
    reindex?: ReindexOverride;
  },
): Command {
  const program = new Command();
  program.exitOverride();
  registerTaskCommands(program, stubCtx(projectDir ?? process.cwd(), overrides));
  return program;
}

describe("listTasksForStates", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("returns empty array when no tasks exist", () => {
    const result = listTasksForStates(join(projectDir, "data", "tasks"), ["ready"]);
    expect(result).toEqual([]);
  });

  it("returns tasks from requested states", () => {
    writeTaskFile(projectDir, "ready", "task-a");
    writeTaskFile(projectDir, "backlog", "task-b");

    const result = listTasksForStates(join(projectDir, "data", "tasks"), ["ready"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("task-a");
    expect(result[0].state).toBe("ready");
  });

  it("returns tasks across multiple states", () => {
    writeTaskFile(projectDir, "ready", "task-a");
    writeTaskFile(projectDir, "doing", "task-b");

    const result = listTasksForStates(join(projectDir, "data", "tasks"), ["ready", "doing"]);
    expect(result).toHaveLength(2);
    const ids = result.map((t) => t.id);
    expect(ids).toContain("task-a");
    expect(ids).toContain("task-b");
  });

  it("skips AGENTS.md files", () => {
    const dir = join(projectDir, "data", "tasks", "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "# Agents");
    writeTaskFile(projectDir, "ready", "task-real");

    const result = listTasksForStates(join(projectDir, "data", "tasks"), ["ready"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("task-real");
  });

  it("returns id and priority from frontmatter", () => {
    writeTaskFile(projectDir, "ready", "task-x", { priority: "p1", title: "My Task" });
    const result = listTasksForStates(join(projectDir, "data", "tasks"), ["ready"]);
    expect(result[0].priority).toBe("p1");
    expect(result[0].title).toBe("My Task");
  });
});

describe("kota task list", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("prints 'No tasks found.' when queue is empty", async () => {
    const program = makeProgram();
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "list"]);
    });
    expect(output).toContain("No tasks found.");
  });

  it("lists tasks from open states by default", async () => {
    writeTaskFile(projectDir, "ready", "task-alpha", { title: "Alpha task", priority: "p1" });
    writeTaskFile(projectDir, "doing", "task-beta", { title: "Beta task", priority: "p2" });

    const program = makeProgram();
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "list"]);
    });
    expect(output).toContain("task-alpha");
    expect(output).toContain("task-beta");
    expect(output).toContain("Alpha task");
  });

  it("filters to specific state with --state", async () => {
    writeTaskFile(projectDir, "ready", "task-ready-one");
    writeTaskFile(projectDir, "backlog", "task-backlog-one");

    const program = makeProgram();
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "list", "--state", "ready"]);
    });
    expect(output).toContain("task-ready-one");
    expect(output).not.toContain("task-backlog-one");
  });
});

describe("kota task show", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("prints full task content", async () => {
    writeTaskFile(projectDir, "doing", "task-show-me");
    const program = makeProgram();
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "show", "task-show-me"]);
    });
    expect(output).toContain("id: task-show-me");
    expect(output).toContain("## Problem");
  });

  it("exits with error for unknown task", async () => {
    const program = makeProgram();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      await expect(
        program.parseAsync(["node", "kota", "task", "show", "task-nonexistent"]),
      ).rejects.toThrow("process.exit:1");
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe("kota task move", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("moves task file and updates status frontmatter", async () => {
    writeTaskFile(projectDir, "ready", "task-mover", { status: "ready" });
    mkdirSync(join(projectDir, "data", "tasks", "doing"), { recursive: true });

    const { execFileSync: mockExecFile } = await import("node:child_process");
    vi.mocked(mockExecFile).mockImplementation(
      (_file: unknown, args?: unknown) => {
        const argv = Array.isArray(args) ? (args as string[]) : [];
        if (argv[0] === "mv") {
          const [, src, dst] = argv;
          const content = readFileSync(src, "utf-8");
          writeFileSync(dst, content);
          rmSync(src);
        }
        return Buffer.from("");
      },
    );

    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync(["node", "kota", "task", "move", "task-mover", "doing"]);
    } finally {
      logSpy.mockRestore();
    }

    expect(existsSync(join(projectDir, "data", "tasks", "ready", "task-mover.md"))).toBe(false);
    expect(existsSync(join(projectDir, "data", "tasks", "doing", "task-mover.md"))).toBe(true);
    const content = readFileSync(join(projectDir, "data", "tasks", "doing", "task-mover.md"), "utf-8");
    expect(content).toMatch(/^status: doing$/m);
  });

  it("prints message when task is already in target state", async () => {
    writeTaskFile(projectDir, "ready", "task-already");

    const program = makeProgram();
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "move", "task-already", "ready"]);
    });
    expect(output).toContain("already in");
  });
});

describe("kota task capture", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
    mkdirSync(join(projectDir, "data", "inbox"), { recursive: true });
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("creates a new inbox task file", async () => {
    const program = makeProgram();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync(["node", "kota", "task", "capture", "Add search filter"]);
    } finally {
      logSpy.mockRestore();
    }

    const filePath = join(projectDir, "data", "inbox", "task-add-search-filter.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Add search filter");
  });

  it("reports the created task ID", async () => {
    const program = makeProgram();
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "capture", "Fix the login bug"]);
    });
    expect(output).toContain("task-fix-the-login-bug");
  });

  it("errors if task file already exists", async () => {
    writeFileSync(
      join(projectDir, "data", "inbox", "task-duplicate.md"),
      "# duplicate\n",
    );

    const program = makeProgram();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      await expect(
        program.parseAsync(["node", "kota", "task", "capture", "duplicate"]),
      ).rejects.toThrow("process.exit:1");
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe("kota task search", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("falls back to keyword path with --keyword and prints matched ids", async () => {
    writeTaskFile(projectDir, "ready", "task-cost-tracker", {
      title: "Track spend anomaly alerts",
    });
    writeTaskFile(projectDir, "done", "task-bread", { title: "Bake bread" });

    const program = makeProgram(projectDir);
    const output = await captureOutput(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "task",
        "search",
        "spend",
        "--keyword",
      ]);
    });
    expect(output).toContain("task-cost-tracker");
    expect(output).not.toContain("task-bread");
  });

  it("exits non-zero with a single-line operator message when semantic is unavailable", async () => {
    const program = makeProgram(projectDir, {
      search: async () => ({ ok: false, reason: "semantic_unavailable" }),
    });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      await expect(
        program.parseAsync(["node", "kota", "task", "search", "cost"]),
      ).rejects.toThrow("process.exit:1");
      const written = errSpy.mock.calls.map((args) => String(args[0])).join("");
      expect(written).toMatch(/Semantic task search requires/);
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("emits structured payload with --json", async () => {
    const program = makeProgram(projectDir, {
      search: async () => ({
        ok: true,
        tasks: [
          {
            id: "task-x",
            title: "T",
            state: "ready",
            priority: "p2",
            area: "a",
            summary: "",
            updatedAt: "2026-04-27T00:00:00.000Z",
            score: 0.5,
          },
        ],
      }),
    });
    const output = await captureOutput(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "task",
        "search",
        "anything",
        "--json",
      ]);
    });
    expect(output.trim()).toContain('"ok":true');
    expect(output.trim()).toContain('"id":"task-x"');
  });

  it("--json with semantic_unavailable exits non-zero but still emits the structured payload", async () => {
    const program = makeProgram(projectDir, {
      search: async () => ({ ok: false, reason: "semantic_unavailable" }),
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    let captured = "";
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        captured += String(chunk);
        return true;
      });
    try {
      await expect(
        program.parseAsync([
          "node",
          "kota",
          "task",
          "search",
          "cost",
          "--json",
        ]),
      ).rejects.toThrow("process.exit:1");
      expect(captured).toContain('"ok":false');
      expect(captured).toContain('"semantic_unavailable"');
    } finally {
      writeSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("filters by --state", async () => {
    writeTaskFile(projectDir, "ready", "task-open-spend", {
      title: "Track spend in open work",
    });
    writeTaskFile(projectDir, "done", "task-closed-spend", {
      title: "Track spend in closed work",
    });

    const program = makeProgram(projectDir);
    const output = await captureOutput(async () => {
      await program.parseAsync([
        "node",
        "kota",
        "task",
        "search",
        "spend",
        "--keyword",
        "--state",
        "ready",
      ]);
    });
    expect(output).toContain("task-open-spend");
    expect(output).not.toContain("task-closed-spend");
  });
});

describe("kota task reindex", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports skipped when no embedding provider is configured", async () => {
    const program = makeProgram(projectDir);
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "reindex"]);
    });
    expect(output).toMatch(/Semantic search not configured/);
  });

  it("prints success counts when reindex completes", async () => {
    const program = makeProgram(projectDir, {
      reindex: async () => ({ indexed: 3, failed: 0 }),
    });
    const output = await captureOutput(async () => {
      await program.parseAsync(["node", "kota", "task", "reindex"]);
    });
    expect(output).toContain("Reindexed");
    expect(output).toContain("3");
  });

  it("exits non-zero when reindex reports failures", async () => {
    const program = makeProgram(projectDir, {
      reindex: async () => ({ indexed: 1, failed: 2 }),
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      await expect(
        program.parseAsync(["node", "kota", "task", "reindex"]),
      ).rejects.toThrow("process.exit:1");
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("buildTaskListNode", () => {
  const SAMPLE = [
    {
      id: "task-alpha",
      priority: "p0",
      state: "ready" as const,
      title: "Stabilize the dispatcher loop after the merge",
    },
    {
      id: "task-beta-with-an-extremely-long-title",
      priority: "p2",
      state: "doing" as const,
      title:
        "A very long task title that should wrap or truncate cleanly under a narrow terminal width without overflowing into the next column or tearing the alignment of the table.",
    },
    {
      id: "task-gamma",
      priority: "p3",
      state: "blocked" as const,
      title: "Awaiting operator capture",
    },
  ];

  for (const { name, theme } of [
    { name: "default", theme: DEFAULT_THEME },
    { name: "ascii", theme: ASCII_THEME },
    { name: "no-color", theme: NO_COLOR_THEME },
  ]) {
    it(`renders the ${name} theme without overflowing a wide terminal`, () => {
      const out = renderToString(
        buildTaskListNode(SAMPLE),
        renderContext({ theme, width: 120 }),
      );
      expect(out).toContain("task-alpha");
      expect(out).toContain("Stabilize the dispatcher loop");
      expect(out).toContain("p0");
      expect(out).toContain("ready");
    });

    it(`compresses Title cleanly under a narrow width in ${name} theme`, () => {
      const out = renderToString(
        buildTaskListNode(SAMPLE),
        renderContext({ theme, width: 60 }),
      );
      // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping for width measurement
      const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
      for (const raw of out.split("\n")) {
        expect(stripAnsi(raw).length).toBeLessThanOrEqual(60);
      }
    });
  }

  it("declares ID/Pri/State/Title columns with Title carrying maxWidth", () => {
    const node = buildTaskListNode(SAMPLE);
    expect(node.columns.map((c) => c.header)).toEqual(["ID", "Pri", "State", "Title"]);
    const titleSpec = node.columns.find((c) => c.header === "Title")!;
    expect(titleSpec.maxWidth).toBeDefined();
  });
});
