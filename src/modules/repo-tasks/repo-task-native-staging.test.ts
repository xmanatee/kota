import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPO_TASK_STAGING_OWNER_ENV,
  REPO_TASK_WORKFLOW_HOST_STAGING_OWNER,
  shouldDeferRepoTaskStagingToWorkflowHost,
} from "./repo-file-mutations.js";
import { moveTaskById } from "./repo-tasks-domain.js";

const mocks = vi.hoisted(() => ({
  stageExistingOrTrackedRepoPaths: vi.fn(),
}));

vi.mock("./repo-file-mutations.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./repo-file-mutations.js")
  >();
  return {
    ...actual,
    stageExistingOrTrackedRepoPaths: mocks.stageExistingOrTrackedRepoPaths,
  };
});

const TASK_ID = "task-native-deferred-staging";
const PROTECTED_INDEX_ERROR = new Error(
  "fatal: Unable to create '/repo/.git/index.lock': Operation not permitted",
);

function writeReadyTask(projectDir: string): void {
  const readyDir = join(projectDir, "data", "tasks", "ready");
  mkdirSync(join(projectDir, "data", "tasks", "doing"), { recursive: true });
  mkdirSync(readyDir, { recursive: true });
  writeFileSync(
    join(readyDir, `${TASK_ID}.md`),
    `---
id: ${TASK_ID}
title: Defer native task staging
status: ready
priority: p2
area: modules
summary: Let the workflow host stage a native task transition.
created_at: 2026-07-25T00:00:00.000Z
updated_at: 2026-07-25T00:00:00.000Z
---

## Done When

- The task reaches doing.

## Acceptance Evidence

- A focused test proves the protected-index path.
`,
    "utf-8",
  );
}

describe("native repo-task staging ownership", () => {
  const roots: string[] = [];
  let previousOwner: string | undefined;

  beforeEach(() => {
    previousOwner = process.env[REPO_TASK_STAGING_OWNER_ENV];
    mocks.stageExistingOrTrackedRepoPaths.mockReset();
    mocks.stageExistingOrTrackedRepoPaths.mockImplementation(() => {
      throw PROTECTED_INDEX_ERROR;
    });
  });

  afterEach(() => {
    if (previousOwner === undefined) {
      delete process.env[REPO_TASK_STAGING_OWNER_ENV];
    } else {
      process.env[REPO_TASK_STAGING_OWNER_ENV] = previousOwner;
    }
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains the move for the declared workflow host to stage", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-native-task-stage-"));
    roots.push(projectDir);
    writeReadyTask(projectDir);
    process.env[REPO_TASK_STAGING_OWNER_ENV] =
      REPO_TASK_WORKFLOW_HOST_STAGING_OWNER;

    expect(moveTaskById(projectDir, TASK_ID, "doing")).toMatchObject({
      id: TASK_ID,
      fromState: "ready",
      toState: "doing",
    });

    const doingPath = join(
      projectDir,
      "data",
      "tasks",
      "doing",
      `${TASK_ID}.md`,
    );
    expect(readFileSync(doingPath, "utf-8")).toMatch(/^status: doing$/m);
    expect(
      existsSync(join(projectDir, "data", "tasks", "ready", `${TASK_ID}.md`)),
    ).toBe(false);
  });

  it("rolls the move back when no workflow host owns staging", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-native-task-rollback-"));
    roots.push(projectDir);
    writeReadyTask(projectDir);
    delete process.env[REPO_TASK_STAGING_OWNER_ENV];

    expect(() => moveTaskById(projectDir, TASK_ID, "doing")).toThrow(
      PROTECTED_INDEX_ERROR,
    );
    expect(
      readFileSync(
        join(projectDir, "data", "tasks", "ready", `${TASK_ID}.md`),
        "utf-8",
      ),
    ).toMatch(/^status: ready$/m);
  });

  it("does not defer a transient index lock", () => {
    const transientIndexError = new Error(
      "fatal: Unable to create '/repo/.git/index.lock': File exists",
    );
    expect(
      shouldDeferRepoTaskStagingToWorkflowHost(transientIndexError, {
        [REPO_TASK_STAGING_OWNER_ENV]:
          REPO_TASK_WORKFLOW_HOST_STAGING_OWNER,
      }),
    ).toBe(false);
  });
});
