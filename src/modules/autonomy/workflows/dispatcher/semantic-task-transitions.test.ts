import { describe, expect, it, vi } from "vitest";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  changedTaskPaths,
  parseChangedTaskPaths,
} from "./semantic-task-transitions.js";

describe("semantic task transitions", () => {
  it("parses task additions, removals, modifications, and renames", () => {
    expect(
      parseChangedTaskPaths([
        "A\tdata/tasks/task-added.md",
        "D\tdata/tasks/task-removed.md",
        "M\tdata/tasks/task-modified.md",
        "R100\tdata/tasks/task-moved.md\tdata/tasks/archive/task-moved.md",
      ].join("\n")),
    ).toEqual([
      { oldPath: null, newPath: "data/tasks/task-added.md" },
      { oldPath: "data/tasks/task-removed.md", newPath: null },
      {
        oldPath: "data/tasks/task-modified.md",
        newPath: "data/tasks/task-modified.md",
      },
      {
        oldPath: "data/tasks/task-moved.md",
        newPath: "data/tasks/archive/task-moved.md",
      },
    ]);
  });

  it("uses the run-owned command rail and treats an unavailable range as unknown", async () => {
    const runCommand = vi.fn<WorkflowCommandRunner>().mockRejectedValue(
      new Error("missing range"),
    );

    await expect(
      changedTaskPaths(runCommand, "/isolated/project", "before", "after"),
    ).resolves.toBeNull();
    expect(runCommand).toHaveBeenCalledWith({
      command: "git",
      args: [
        "diff",
        "--name-status",
        "--find-renames",
        "before..after",
        "--",
        "data/tasks",
      ],
      cwd: "/isolated/project",
      timeoutMs: 30_000,
      outputLimitBytes: 20 * 1024 * 1024,
      captureLimitBytesPerStream: 20 * 1024 * 1024,
    });
  });
});
