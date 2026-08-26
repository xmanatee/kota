import { resolve } from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { registerDefinitionLogCommand } from "./definition-log.js";

const execFileSyncMock = vi.hoisted(() => vi.fn());
const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFileSync: execFileSyncMock,
    execSync: execSyncMock,
  };
});

function program(): Command {
  const command = new Command("workflow");
  command.exitOverride();
  registerDefinitionLogCommand(command, {
    getContributedWorkflows: () => [{
      name: "safe-history",
      definitionPath: "src/workflows/agent's;touch-nope.ts",
    }],
  } as unknown as ModuleContext);
  return command;
}

beforeEach(() => {
  execFileSyncMock.mockReset().mockImplementation(
    (_command: string, args: readonly string[]) => {
      if (args[0] === "rev-parse") return `${process.cwd()}\n`;
      if (args[0] === "ls-files") return "tracked\n";
      return "abc1234 2026-08-26 subprocess safety";
    },
  );
  execSyncMock.mockReset().mockReturnValue("legacy shell execution");
});

describe("workflow definition-log subprocess", () => {
  it("uses bounded git argv calls and keeps the definition path in one argument", async () => {
    await program().parseAsync(["definition-log", "safe-history", "--diff"], {
      from: "user",
    });

    const definitionPath = resolve(
      process.cwd(),
      "src/workflows/agent's;touch-nope.ts",
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      1,
      "git",
      ["rev-parse", "--show-toplevel"],
      expect.objectContaining({ timeout: 10_000, maxBuffer: 1024 * 1024 }),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      2,
      "git",
      ["ls-files", "--", definitionPath],
      expect.objectContaining({ timeout: 10_000, maxBuffer: 1024 * 1024 }),
    );
    expect(execFileSyncMock).toHaveBeenNthCalledWith(
      3,
      "git",
      [
        "log",
        "--patch",
        "--pretty=format:%h %ad %s",
        "--date=short",
        "--",
        definitionPath,
      ],
      expect.objectContaining({ timeout: 10_000, maxBuffer: 1024 * 1024 }),
    );
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});
