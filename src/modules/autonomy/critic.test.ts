import "./critic-test-fixture.integration.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  getMockRunBlocking,
  getOptionsArg,
  getPromptArg,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeOpenTask,
} from "./critic-test-fixture.integration.js";
import { builderRepairChecks } from "./workflows/builder/repair-checks.js";

const mockRunAgentHarness = getMockRunAgentHarness();
const mockRunBlocking = getMockRunBlocking();

function builderTaskPayload(taskId: string): Record<string, unknown> {
  const taskDigest = taskId === "task-alpha" ? "a".repeat(64) : "b".repeat(64);
  return {
    taskId,
    taskPath: `data/tasks/${taskId}.md`,
    taskState: "open",
    taskDigest,
    idempotencyKey: `builder:${taskId}:${taskDigest}`,
  };
}

function builderCriticCheck(): CodeCheck {
  const check = builderRepairChecks().find((candidate) => candidate.id === "critic-review");
  if (!check || check.type !== "code") throw new Error("missing builder critic check");
  return check as CodeCheck;
}

describe("createCriticCheck", () => {
  beforeEach(resetCriticTestMocks);

  it("runs through the workflow agent runtime instead of requiring a separate SDK key", async () => {
    const dir = makeTmpDir();
    writeOpenTask(dir, "task-test.md", "---\nstatus: open\npriority: p2\n---\n\n# Test\n\nContent.");
    makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks complete.",
    });

    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);
    expect(mockRunBlocking).toHaveBeenCalledWith(
      expect.objectContaining({ exportName: "inspectCriticReviewInWorker" }),
      expect.objectContaining({ reviewDir: dir }),
    );
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
  });

  it("reviews task and diff from workspaceDir when provided", async () => {
    const workspaceRoot = makeTmpDir();
    const workspaceDir = makeTmpDir();
    writeOpenTask(
      workspaceDir,
      "task-workspace.md",
      "---\nstatus: open\npriority: p2\n---\n\n# Workspace task\n\nWorkspace task content.",
    );
    const runDir = makeRunDir(workspaceRoot);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Workspace diff looks complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(
      makeContext(workspaceRoot, runDir, workspaceDir),
      TEST_PARENT_STEP,
    );

    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("Workspace task content.");
    expect(userMessage).toContain(`Workspace root: ${workspaceDir}`);
    expect(mockRunAgentHarness.mock.calls[0]?.[1]).toMatchObject({
      cwd: workspaceDir,
    });
  });

  it("keeps simultaneous builder critics bound to their own task identities", async () => {
    const alphaWorkspace = makeTmpDir();
    const betaWorkspace = makeTmpDir();
    for (const workspace of [alphaWorkspace, betaWorkspace]) {
      writeOpenTask(
        workspace,
        "task-alpha.md",
        "---\nstatus: open\npriority: p2\n---\n\n# Alpha\n\nAlpha task only.",
      );
      writeOpenTask(
        workspace,
        "task-beta.md",
        "---\nstatus: open\npriority: p2\n---\n\n# Beta\n\nBeta task only.",
      );
    }
    const alphaProject = makeTmpDir();
    const betaProject = makeTmpDir();
    const alphaRunDir = makeRunDir(alphaProject);
    const betaRunDir = makeRunDir(betaProject);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Expected task reviewed.",
    });

    const check = builderCriticCheck();
    await Promise.all([
      check.run(
        makeContext(
          alphaProject,
          alphaRunDir,
          alphaWorkspace,
          undefined,
          builderTaskPayload("task-alpha"),
        ),
        TEST_PARENT_STEP,
      ),
      check.run(
        makeContext(
          betaProject,
          betaRunDir,
          betaWorkspace,
          undefined,
          builderTaskPayload("task-beta"),
        ),
        TEST_PARENT_STEP,
      ),
    ]);

    const promptsByWorkspace = new Map(
      mockRunAgentHarness.mock.calls.map((call) => [
        String(getOptionsArg(call).cwd),
        getPromptArg(call).split("## Changed files", 1)[0],
      ]),
    );
    expect(promptsByWorkspace.get(alphaWorkspace)).toContain("Alpha task only.");
    expect(promptsByWorkspace.get(alphaWorkspace)).not.toContain("Beta task only.");
    expect(promptsByWorkspace.get(betaWorkspace)).toContain("Beta task only.");
    expect(promptsByWorkspace.get(betaWorkspace)).not.toContain("Alpha task only.");
  });

  it("fails closed when the builder critic cannot find its expected task", async () => {
    const workspaceRoot = makeTmpDir();
    const workspaceDir = makeTmpDir();
    writeOpenTask(
      workspaceDir,
      "task-alpha.md",
      "---\nstatus: open\npriority: p2\n---\n\n# Alpha\n\nUnrelated task.",
    );
    const runDir = makeRunDir(workspaceRoot);
    const check = builderCriticCheck();

    await expect(
      check.run(
        makeContext(
          workspaceRoot,
          runDir,
          workspaceDir,
          undefined,
          builderTaskPayload("task-beta"),
        ),
        TEST_PARENT_STEP,
      ),
    ).rejects.toThrow(/expected task task-beta.*not found/i);
    expect(mockRunAgentHarness).not.toHaveBeenCalled();
  });

  it("skips when no target task and no staged archive move exist", async () => {
    const dir = makeTmpDir();
    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir), TEST_PARENT_STEP);
    expect(result).toMatch(/skipping critic review/);
  });

  it("finds a done task via its staged archive move", async () => {
    const dir = makeTmpDir();
    const doneDir = join(dir, "data/tasks/archive");
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(
      join(doneDir, "task-moved.md"),
      "---\nstatus: done\n---\n\n# Moved task\n\nTask content.",
    );
    const runDir = makeRunDir(dir);

    const taskMutationStatus =
      "R100\tdata/tasks/task-moved.md\tdata/tasks/archive/task-moved.md\n";
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks good.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(
      makeContext(dir, runDir, undefined, undefined, {}, taskMutationStatus),
      TEST_PARENT_STEP,
    );

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    expect(getPromptArg(mockRunAgentHarness.mock.calls[0])).toContain("Moved task");
  });

  it("reviews a staged done task before collateral blocked task edits", async () => {
    const dir = makeTmpDir();
    const blockedDir = join(dir, "data/tasks");
    const doneDir = join(dir, "data/tasks/archive");
    mkdirSync(blockedDir, { recursive: true });
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(
      join(blockedDir, "task-collateral-blocker.md"),
      "---\nstatus: blocked\npriority: p2\n---\n\n# Collateral blocker\n\nBlocked task content.",
    );
    writeFileSync(
      join(doneDir, "task-implemented-work.md"),
      "---\nstatus: done\n---\n\n# Implemented work\n\nDone task content.",
    );
    const runDir = makeRunDir(dir);

    const taskMutationStatus = [
      "M\tdata/tasks/task-collateral-blocker.md",
      "A\tdata/tasks/archive/task-implemented-work.md",
      "",
    ].join("\n");
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks good.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(
      makeContext(dir, runDir, undefined, undefined, {}, taskMutationStatus),
      TEST_PARENT_STEP,
    );

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    const taskSection = userMessage.split("## Changed files", 1)[0];
    expect(taskSection).toContain("Implemented work");
    expect(taskSection).not.toContain("Collateral blocker");
  });

  it("calls the critic agent and passes on pass verdict", async () => {
    const dir = makeTmpDir();
    writeOpenTask(dir, "task-foo.md", "---\nstatus: open\npriority: p2\n---\n\n# Do foo\n\nDo foo.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Work looks complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
  });
});
