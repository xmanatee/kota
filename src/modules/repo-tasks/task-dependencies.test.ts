import { describe, expect, it } from "vitest";
import {
  findDuplicateTaskDependencyIds,
  findUnfinishedTaskDependencies,
  parseTaskDependencyIds,
  readTaskDependencyIds,
} from "./task-dependencies.js";

describe("task dependencies", () => {
  it("parses absent and array frontmatter dependency declarations", () => {
    expect(parseTaskDependencyIds({}).ok).toBe(true);
    expect(
      parseTaskDependencyIds({
        depends_on: ["task-enabler-a", "task-enabler-b"],
      }),
    ).toEqual({
      ok: true,
      dependencies: ["task-enabler-a", "task-enabler-b"],
    });
  });

  it("rejects scalar and malformed dependency declarations", () => {
    expect(parseTaskDependencyIds({ depends_on: "task-enabler" })).toMatchObject({
      ok: false,
    });
    expect(parseTaskDependencyIds({ depends_on: ["not-a-task"] })).toMatchObject({
      ok: false,
    });
  });

  it("throws when callers require a well-formed dependency declaration", () => {
    expect(() => readTaskDependencyIds({ depends_on: "task-enabler" })).toThrow(
      "depends_on must be a frontmatter array",
    );
  });

  it("identifies duplicates and unfinished predecessors", () => {
    expect(
      findDuplicateTaskDependencyIds([
        "task-a",
        "task-b",
        "task-a",
        "task-b",
      ]),
    ).toEqual(["task-a", "task-b"]);

    const states = new Map([
      ["task-a", "done"],
      ["task-b", "ready"],
    ]);
    expect(
      findUnfinishedTaskDependencies(["task-a", "task-b", "task-missing"], states),
    ).toEqual(["task-b", "task-missing"]);
  });
});
