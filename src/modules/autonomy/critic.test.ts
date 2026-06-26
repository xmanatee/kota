import "./critic-test-fixture.integration.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  getMockRunAgentHarness,
  getPromptArg,
  makeContext,
  makeRunDir,
  makeTmpDir,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeDoingTask,
} from "./critic-test-fixture.integration.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("createCriticCheck", () => {
  beforeEach(resetCriticTestMocks);

  it("runs through the workflow agent runtime instead of requiring a separate SDK key", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-test.md", "---\ntitle: Test\n---\nContent.");
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
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
  });

  it("reviews task and diff from workspaceDir when provided", async () => {
    const projectDir = makeTmpDir();
    const workspaceDir = makeTmpDir();
    writeDoingTask(
      workspaceDir,
      "task-workspace.md",
      "---\ntitle: Workspace task\n---\nWorkspace task content.",
    );
    const runDir = makeRunDir(projectDir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Workspace diff looks complete.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(
      makeContext(projectDir, runDir, workspaceDir),
      TEST_PARENT_STEP,
    );

    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("Workspace task content.");
    expect(userMessage).toContain(`Project root: ${workspaceDir}`);
    expect(mockRunAgentHarness.mock.calls[0]?.[1]).toMatchObject({
      cwd: workspaceDir,
    });
  });

  it("skips when no task in doing/ and no staged done/ task", async () => {
    const dir = makeTmpDir();
    const check = createCriticCheck();
    const result = await (check as CodeCheck).run(makeContext(dir), TEST_PARENT_STEP);
    expect(result).toMatch(/skipping critic review/);
  });

  it("finds task in done/ via staged git diff when doing/ is empty", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const doneDir = join(dir, "data/tasks/done");
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(join(doneDir, "task-moved.md"), "---\ntitle: Moved task\n---\nTask content.");
    const runDir = makeRunDir(dir);

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("data/tasks/done/")) {
        return `R100\tdata/tasks/backlog/task-moved.md\tdata/tasks/done/task-moved.md\n`;
      }
      return "";
    });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks good.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    expect(result).toMatch(/pass/);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
    expect(getPromptArg(mockRunAgentHarness.mock.calls[0])).toContain("Moved task");
  });

  it("reviews a staged done task before collateral blocked task edits", async () => {
    const { execFileSync } = await import("node:child_process");
    const dir = makeTmpDir();
    const blockedDir = join(dir, "data/tasks/blocked");
    const doneDir = join(dir, "data/tasks/done");
    mkdirSync(blockedDir, { recursive: true });
    mkdirSync(doneDir, { recursive: true });
    writeFileSync(
      join(blockedDir, "task-collateral-blocker.md"),
      "---\ntitle: Collateral blocker\n---\nBlocked task content.",
    );
    writeFileSync(
      join(doneDir, "task-implemented-work.md"),
      "---\ntitle: Implemented work\n---\nDone task content.",
    );
    const runDir = makeRunDir(dir);

    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const argStr = Array.isArray(args) ? args.join(" ") : "";
      if (argStr.includes("data/tasks/done/")) {
        return [
          "M\tdata/tasks/blocked/task-collateral-blocker.md",
          "A\tdata/tasks/done/task-implemented-work.md",
          "",
        ].join("\n");
      }
      return "";
    });
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Looks good.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("Implemented work");
    expect(userMessage).not.toContain("Collateral blocker");
  });

  it("calls the critic agent and passes on pass verdict", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-foo.md", "---\ntitle: Do foo\n---\nDo foo.");
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
