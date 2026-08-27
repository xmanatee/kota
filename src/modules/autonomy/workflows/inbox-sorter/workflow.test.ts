import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import inboxSorterWorkflow from "./workflow.js";

const TASK_STATES = [
  "open",
  "open",
  "open",
  "blocked",
  "done",
  "dropped",
] as const;

function createInboxRepo(captures: readonly string[] = []): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-inbox-sorter-"));
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "scenario@kota.local"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "KOTA scenario"], {
    cwd: workspaceRoot,
  });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  for (const state of TASK_STATES) {
    const stateDir = join(workspaceRoot, "data", "tasks", state);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "AGENTS.md"), `# ${state}\n`);
  }
  const inboxDir = join(workspaceRoot, "data", "inbox");
  mkdirSync(inboxDir, { recursive: true });
  writeFileSync(join(inboxDir, "AGENTS.md"), "# inbox\n");
  captures.forEach((capture, index) => {
    writeFileSync(join(inboxDir, `capture-${index + 1}.md`), `${capture}\n`);
  });
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "scenario baseline"], {
    cwd: workspaceRoot,
  });
  return workspaceRoot;
}

function sorterAgentOutputs() {
  return {
    "sort-inbox": { content: "Inbox entries sorted." },
    "shadow-semantic-review": {
      decision: "pass",
      summary: "The sorting preserves source intent and queue integrity.",
      citedArtifacts: ["metadata:inspect-inbox"],
      findings: [],
    },
  };
}

describe("inbox-sorter workflow", () => {
  it("skips sorting when inbox is empty", async () => {
    const workspaceRoot = createInboxRepo();
    const result = await new WorkflowScenarioDriver(inboxSorterWorkflow, {
      workspaceRoot,
      trigger: { event: "autonomy.inbox.available", payload: {} },
    }).run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-inbox"].output).toMatchObject({
      inboxCount: 0,
      needsAttention: false,
    });
    expect(result.steps["sort-inbox"].status).toBe("skipped");
  });

  it("rejects untracked files outside inbox", async () => {
    const workspaceRoot = createInboxRepo();
    writeFileSync(join(workspaceRoot, "data", "inbox", "capture.md"), "Sort me.\n");
    mkdirSync(join(workspaceRoot, "tmp"));
    writeFileSync(join(workspaceRoot, "tmp", "scratch.txt"), "unrelated\n");

    const result = await new WorkflowScenarioDriver(inboxSorterWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger: { event: "autonomy.inbox.available", payload: {} },
    }).run();

    expect(result.status).toBe("failed");
    expect(result.steps["inspect-inbox"].error).toContain(
      "Repository has changes outside inbox",
    );
  });

  it("allows untracked inbox entries", async () => {
    const workspaceRoot = createInboxRepo();
    writeFileSync(join(workspaceRoot, "data", "inbox", "capture.md"), "Sort me.\n");

    const result = await new WorkflowScenarioDriver(inboxSorterWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger: { event: "autonomy.inbox.available", payload: {} },
      stepOutputs: sorterAgentOutputs(),
      ports: { runCommand: successfulWorkflowCommandRun },
    }).run();

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    expect(result.steps["inspect-inbox"].output).toMatchObject({
      inboxCount: 1,
      needsAttention: true,
    });
    expect(result.steps["sort-inbox"].status).toBe("success");
  });

  it("rejects tracked changes outside inbox", async () => {
    const workspaceRoot = createInboxRepo(["Sort me."]);
    writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n*.local\n");

    const result = await new WorkflowScenarioDriver(inboxSorterWorkflow, {
      workspaceRoot,
      workspaceDir: workspaceRoot,
      trigger: { event: "autonomy.inbox.available", payload: {} },
    }).run();

    expect(result.status).toBe("failed");
    expect(result.steps["inspect-inbox"].error).toContain(".gitignore");
  });

  it("sorts populated inboxes and validates the resulting queue", async () => {
    const workspaceRoot = createInboxRepo(["First capture.", "Second capture."]);
    const runCommand = vi.fn(successfulWorkflowCommandRun);

    const result = await new WorkflowScenarioDriver(inboxSorterWorkflow, {
      workspaceRoot,
      trigger: { event: "autonomy.inbox.available", payload: {} },
      stepOutputs: sorterAgentOutputs(),
      ports: { runCommand },
    }).run();

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    expect(result.steps["inspect-inbox"].output).toMatchObject({
      inboxCount: 2,
      needsAttention: true,
    });
    expect(result.steps["sort-inbox"].status).toBe("success");
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: result.workspaceDir,
    }));
  });
});
