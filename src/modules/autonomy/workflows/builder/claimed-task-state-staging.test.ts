import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stageRepoTaskStateMutation: vi.fn(() => [
    "data/tasks/ready/task-claimed.md",
    "data/tasks/done/task-claimed.md",
  ]),
}));

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", () => ({
  stageRepoTaskStateMutation: mocks.stageRepoTaskStateMutation,
}));

import { builderRepairChecks } from "./repair-checks.js";
import { checkClaimedTaskStateStaged } from "./task-state-repair-checks.js";

describe("builder claimed-task host staging", () => {
  beforeEach(() => {
    mocks.stageRepoTaskStateMutation.mockClear();
  });

  it("retries domain-owned staging for only the claimed task before queue validation", () => {
    expect(
      checkClaimedTaskStateStaged("/repo", {
        claimed: true,
        taskId: "task-claimed",
      } as never),
    ).toBe("OK: staged 2 state path(s) for claimed task task-claimed");
    expect(mocks.stageRepoTaskStateMutation).toHaveBeenCalledWith(
      "/repo",
      "task-claimed",
    );

    const checks = builderRepairChecks();
    expect(
      checks.findIndex(
        (candidate) => candidate.id === "claimed-task-state-staged",
      ),
    ).toBeLessThan(
      checks.findIndex((candidate) => candidate.id === "task-queue-valid"),
    );
  });
});
