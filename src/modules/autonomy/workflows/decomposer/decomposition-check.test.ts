import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { checkDecompositionApplied } from "./decomposition-check.js";

vi.mock("#core/workflow/steps/agent-write-scope.js", () => ({
  listWorkflowMutatedPaths: vi.fn(),
}));

const ORIGINAL_ID = "task-original";
const SUBTASK_ID = "task-subtask";

function writeTask(
  workspaceRoot: string,
  state: "open" | "dropped",
  id: string,
  body: string,
): void {
  const dir = state === "dropped"
    ? join(workspaceRoot, "data", "tasks", "archive")
    : join(workspaceRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.md`),
    [
      "---",
      `status: ${state}`,
      ...(state === "open" ? ["priority: p1"] : []),
      "---",
      "",
      `# ${id}`,
      "",
      body,
      "",
    ].join("\n"),
  );
}

describe("checkDecompositionApplied", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "kota-decomposition-check-"));
    vi.mocked(listWorkflowMutatedPaths).mockReturnValue([]);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("accepts a dropped original and open subtasks changed by the run", () => {
    writeTask(
      workspaceRoot,
      "dropped",
      ORIGINAL_ID,
      `## Decomposed\n\n- ${SUBTASK_ID}`,
    );
    writeTask(workspaceRoot, "open", SUBTASK_ID, "## Problem\n\nScoped work.");
    vi.mocked(listWorkflowMutatedPaths).mockReturnValue([
      `data/tasks/archive/${ORIGINAL_ID}.md`,
      `data/tasks/${SUBTASK_ID}.md`,
    ]);

    expect(checkDecompositionApplied(workspaceRoot, ORIGINAL_ID)).toBe(
      `OK: archived ${ORIGINAL_ID} as dropped and prepared 1 open subtask(s)`,
    );
  });

  it("reads canonical task ids that end in a hyphen", () => {
    const subtaskId = "task-existing-trailing-id-";
    writeTask(
      workspaceRoot,
      "dropped",
      ORIGINAL_ID,
      `## Decomposed\n\n- ${subtaskId}`,
    );
    writeTask(workspaceRoot, "open", subtaskId, "## Problem\n\nScoped work.");
    vi.mocked(listWorkflowMutatedPaths).mockReturnValue([
      `data/tasks/archive/${ORIGINAL_ID}.md`,
      `data/tasks/${subtaskId}.md`,
    ]);

    expect(checkDecompositionApplied(workspaceRoot, ORIGINAL_ID)).toBe(
      `OK: archived ${ORIGINAL_ID} as dropped and prepared 1 open subtask(s)`,
    );
  });

  it("rejects an original left in the active queue", () => {
    writeTask(workspaceRoot, "open", ORIGINAL_ID, "## Problem\n\nStill active.");

    expect(() => checkDecompositionApplied(workspaceRoot, ORIGINAL_ID)).toThrow(
      `Decomposer must move ${ORIGINAL_ID} to dropped`,
    );
  });

  it("rejects a dropped original without named subtasks", () => {
    writeTask(workspaceRoot, "dropped", ORIGINAL_ID, "## Decomposed\n\nNo task yet.");

    expect(() => checkDecompositionApplied(workspaceRoot, ORIGINAL_ID)).toThrow(
      `## Decomposed for ${ORIGINAL_ID} must name at least one subtask`,
    );
  });

  it("rejects a referenced subtask outside open", () => {
    writeTask(
      workspaceRoot,
      "dropped",
      ORIGINAL_ID,
      `## Decomposed\n\n- ${SUBTASK_ID}`,
    );

    expect(() => checkDecompositionApplied(workspaceRoot, ORIGINAL_ID)).toThrow(
      `Decomposed subtasks must be open: ${SUBTASK_ID}`,
    );
  });

  it("rejects task files not changed by the decomposition run", () => {
    writeTask(
      workspaceRoot,
      "dropped",
      ORIGINAL_ID,
      `## Decomposed\n\n- ${SUBTASK_ID}`,
    );
    writeTask(workspaceRoot, "open", SUBTASK_ID, "## Problem\n\nScoped work.");
    vi.mocked(listWorkflowMutatedPaths).mockReturnValue([
      `data/tasks/archive/${ORIGINAL_ID}.md`,
    ]);

    expect(() => checkDecompositionApplied(workspaceRoot, ORIGINAL_ID)).toThrow(
      `Decomposition must create or update its task files: data/tasks/${SUBTASK_ID}.md`,
    );
  });
});
