import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerTaskCommands } from "./cli.js";
import type {
  RepoTaskCreateOptions,
  RepoTaskGcOptions,
  RepoTaskSearchFilter,
  RepoTaskState,
} from "./client.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerTaskCommands(program, {
    cwd: process.cwd(),
    client: {
      tasks: {
        async list() {
          return { tasks: [] };
        },
        async show() {
          return { found: false as const };
        },
        async move(_id: string, _toState: RepoTaskState) {
          return { ok: false as const, reason: "invalid_id" as const };
        },
        async create(_options: RepoTaskCreateOptions) {
          return { ok: false as const, reason: "invalid_slug" as const };
        },
        async capture() {
          return { ok: false as const, reason: "invalid_slug" as const };
        },
        async gc(_options?: RepoTaskGcOptions) {
          return { archived: [], deleted: [] };
        },
        async search(_query: string, _filter?: RepoTaskSearchFilter) {
          return { ok: true as const, tasks: [] };
        },
        async reindex() {
          return { indexed: 0, failed: 0 };
        },
      },
    },
  } as unknown as ModuleContext);
  return program;
}

describe("kota task move security", () => {
  it("prints a client error for invalid task ids without invoking git", async () => {
    const { execFileSync: mockExecFile } = await import("node:child_process");
    vi.mocked(mockExecFile).mockClear();

    const program = makeProgram();
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    try {
      await expect(
        program.parseAsync(["node", "kota", "task", "move", "../AGENTS", "doing"]),
      ).rejects.toThrow("process.exit:1");
      const stderr = errSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(stderr).toContain('Invalid task id "../AGENTS".');
      expect(mockExecFile).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});
