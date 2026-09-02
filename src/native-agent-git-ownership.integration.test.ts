import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type KotaAgentMessage,
  kotaAgentCommandTraceMatches,
  WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION,
} from "#core/agent-harness/index.js";
import { buildRepairPrompt } from "#core/workflow/repair-loop.js";
import { RunLifecycle } from "#core/workflow/run-lifecycle.js";
import { RunResourceAllocator } from "#core/workflow/run-resources.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { readWriterIntegrationEvidence } from "#core/workflow/writer-integration-evidence.js";
import { antigravityCliAgentHarness } from "#modules/antigravity-cli-agent-harness/adapter.js";
import { ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV } from "#modules/antigravity-cli-agent-harness/runtime-home.js";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  actualSpawn: undefined as
    | typeof import("node:child_process").spawn
    | undefined,
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  childProcessMocks.actualSpawn = actual.spawn;
  return { ...actual, spawn: childProcessMocks.spawn };
});

const roots: string[] = [];
const stores: RunStateDatabase[] = [];
const canBootstrapMacosSandbox = process.platform === "darwin" &&
  spawnSync(
    "/usr/bin/sandbox-exec",
    ["-p", "(version 1)\n(allow default)", "/usr/bin/true"],
    { stdio: "ignore" },
  ).status === 0;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function writeFakeAgyExecutable(root: string): string {
  const path = join(root, ".kota", "test-bin", "agy");
  write(
    root,
    ".kota/test-bin/agy",
    [
      `#!${process.execPath}`,
      'const { execFileSync } = require("node:child_process");',
      'const { mkdirSync, writeFileSync } = require("node:fs");',
      'const { dirname, join } = require("node:path");',
      "const args = process.argv.slice(2);",
      'const prompt = args[args.indexOf("--print") + 1] || "";',
      'const repair = args.includes("--conversation");',
      'const conversationId = repair ? "agy-repair" : "agy-initial";',
      'const editedPath = repair ? "data/tasks/task-repair.md" : "data/tasks/task-initial.md";',
      'const readOnlyGitCommand = repair ? "git diff -- data/tasks/task-initial.md" : "git status --short";',
      'execFileSync("git", repair ? ["diff", "--", "data/tasks/task-initial.md"] : ["status", "--short"], { stdio: "ignore" });',
      "mkdirSync(dirname(editedPath), { recursive: true });",
      'writeFileSync(editedPath, repair ? "repair turn edit\\n" : "initial turn edit\\n");',
      'const runDir = process.env.KOTA_RUN_DIR;',
      'if (!runDir) throw new Error("KOTA_RUN_DIR is required");',
      "mkdirSync(runDir, { recursive: true });",
      'writeFileSync(join(runDir, repair ? "repair-prompt.txt" : "initial-prompt.txt"), prompt);',
      'if (repair) writeFileSync(join(runDir, "commit-message.txt"), "align native Git ownership\\n");',
      "const events = [",
      "  { event: \"init\", conversation_id: conversationId },",
      "  { event: \"step_update\", step_update: { conversation_id: conversationId, step_type: \"tool\", state: \"COMPLETED\", tool_name: \"run_command\", tool_info: { name: \"run_command\", parameters: { command: readOnlyGitCommand } } } },",
      "  { event: \"step_update\", step_update: { conversation_id: conversationId, step_type: \"tool\", state: \"COMPLETED\", tool_name: \"write_file\", tool_info: { name: \"write_file\", parameters: { path: editedPath } } } },",
      "  { event: \"result\", result: { conversation_id: conversationId, status: \"SUCCESS\", response: `Updated ${editedPath}`, num_turns: 1, usage: { input_tokens: 20, output_tokens: 5 } } },",
      "];",
      'process.stdout.write(`${events.map((event) => JSON.stringify(event)).join("\\n")}\\n`);',
      "",
    ].join("\n"),
  );
  execFileSync("chmod", ["755", path]);
  return realpathSync.native(path);
}

function hasLaunchPair(args: readonly string[], flag: string, path: string): boolean {
  return args.some((arg, index) =>
    arg === flag && args[index + 1] === path && args[index + 2] === path
  );
}

function unwrapVerifiedSandboxLaunch(input: {
  command: string;
  args: readonly string[];
  taskRoot: string;
  agentRoot: string;
  gitMetadataPath: string;
}): { executable: string; args: string[] } {
  if (input.command === "/usr/bin/sandbox-exec") {
    const profileIndex = input.args.indexOf("-p");
    const profile = input.args[profileIndex + 1] ?? "";
    for (const writableRoot of [input.taskRoot, input.agentRoot]) {
      if (!profile.includes(`(subpath ${JSON.stringify(writableRoot)})`)) {
        throw new Error(`native sandbox did not grant AGY writes to ${writableRoot}`);
      }
    }
    if (!profile.includes(`(literal ${JSON.stringify(input.gitMetadataPath)})`)) {
      throw new Error("native sandbox did not protect linked-worktree Git metadata");
    }
    return {
      executable: input.args[profileIndex + 2]!,
      args: [...input.args.slice(profileIndex + 3)],
    };
  }

  const separator = input.args.lastIndexOf("--");
  if (separator < 0) {
    throw new Error(`unexpected native sandbox launch command ${input.command}`);
  }
  for (const writableRoot of [input.taskRoot, input.agentRoot]) {
    if (!hasLaunchPair(input.args, "--bind", writableRoot)) {
      throw new Error(`native sandbox did not grant AGY writes to ${writableRoot}`);
    }
  }
  if (!hasLaunchPair(input.args, "--ro-bind", input.gitMetadataPath)) {
    throw new Error("native sandbox did not protect linked-worktree Git metadata");
  }
  return {
    executable: input.args[separator + 1]!,
    args: [...input.args.slice(separator + 2)],
  };
}

function occurrenceCount(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe("native agent Git ownership", () => {
  it("keeps AGY initial and repair edits unstaged until the workflow host publishes them", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-native-git-ownership-"));
    roots.push(root);
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.name", "KOTA Test");
    git(root, "config", "user.email", "kota@example.test");
    git(root, "config", "commit.gpgsign", "false");
    write(root, ".gitignore", ".kota/\n");
    write(root, "data/tasks/task-initial.md", "initial\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    const fakeAgyExecutable = writeFakeAgyExecutable(root);
    const fakeKeychainPath = join(root, ".kota", "test-keychain.db");
    write(root, ".kota/test-keychain.db", "fixture\n");

    const store = new RunStateDatabase(join(root, ".kota", "state"));
    stores.push(store);
    store.registerScope({
      id: "scope-native-git",
      rootPath: root,
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    const { epoch } = store.beginDaemonSession("2026-09-02T00:00:01.000Z");
    store.admitRun({
      id: "run-native-git",
      scopeId: "scope-native-git",
      workflow: "native-git-fixture",
      repository: "write",
      trigger: { event: "fixture.ready", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: "2026-09-02T00:00:02.000Z",
    });
    store.startRun("run-native-git", epoch, "2026-09-02T00:00:03.000Z");
    const run = store.getRun("run-native-git")!;
    write(
      root,
      `.kota/runs/${run.id}/metadata.json`,
      `${JSON.stringify({
        id: run.id,
        workflow: run.workflow,
        definitionPath: "fixture/workflow.ts",
        trigger: run.trigger,
        startedAt: "2026-09-02T00:00:03.000Z",
        completedAt: "2026-09-02T00:00:04.000Z",
        durationMs: 1_000,
        status: "success",
        runDir: `.kota/runs/${run.id}`,
        steps: [],
      })}\n`,
    );

    const messages: KotaAgentMessage[] = [];
    let unstagedPaths: string[] = [];
    let initialPrompt = "";
    let repairTurnPrompt = "";
    const lifecycle = new RunLifecycle({
      store,
      daemonEpoch: epoch,
      createResourceAllocator: (state) =>
        new RunResourceAllocator(state, {
          portStart: 30_000,
          portEnd: 30_019,
          portRangeSize: 20,
          isPortAvailable: async () => true,
        }),
      validate: async () => ({ status: "passed", evidence: ["fixture passed"] }),
      continueIntegration: async () => undefined,
      executeWorkflow: async (context) => {
        const workspace = context.sandbox.workspaceDir;
        const taskWriteScope = join(workspace, "data", "tasks");
        const actualSpawn = childProcessMocks.actualSpawn;
        if (actualSpawn === undefined) throw new Error("actual spawn is unavailable");
        childProcessMocks.spawn.mockImplementation((command, args, options) => {
          const commandArgs = args ?? [];
          const launch = unwrapVerifiedSandboxLaunch({
            command,
            args: commandArgs,
            taskRoot: taskWriteScope,
            agentRoot: context.resources.agentDir,
            gitMetadataPath: join(workspace, ".git"),
          });
          if (launch.executable !== fakeAgyExecutable) {
            throw new Error(`unexpected AGY executable ${launch.executable}`);
          }
          if (canBootstrapMacosSandbox) {
            return actualSpawn(command, commandArgs, options);
          }
          // Nested macOS runners cannot always apply another sandbox profile.
          // The verified production launch still owns the permission oracle;
          // only its wrapper is replaced before the fixture child is spawned.
          return actualSpawn(launch.executable, launch.args, options);
        });
        const harnessEnvironment = {
          ...context.resources.env,
          PATH: [dirname(fakeAgyExecutable), process.env.PATH]
            .filter(Boolean)
            .join(delimiter),
          [ANTIGRAVITY_CLI_KEYCHAIN_PATH_ENV]: fakeKeychainPath,
        };

        const initialResult = await antigravityCliAgentHarness.run({
          prompt: "Update the initial task file.",
          systemPrompt: "Follow the task contract.",
          model: "gemini-3.7-flash",
          effort: "xhigh",
          cwd: workspace,
          scopeRoot: root,
          agentWriteScope: [taskWriteScope],
          agentOutputDir: context.resources.agentDir,
          env: harnessEnvironment,
          onMessage: (message) => {
            messages.push(message);
          },
        });
        expect(initialResult.isError).toBe(false);
        expect(readFileSync(join(workspace, "data/tasks/task-initial.md"), "utf8"))
          .toBe("initial turn edit\n");
        initialPrompt = readFileSync(
          join(context.resources.agentDir, "initial-prompt.txt"),
          "utf8",
        );

        const step: WorkflowAgentStep = {
          id: "build",
          type: "agent",
          promptPath: "fixture/prompt.md",
          moduleRoot: root,
          model: "gemini-3.7-flash",
          effort: "xhigh",
          harness: "antigravity-cli",
          autonomyMode: "autonomous",
        };
        const repairPrompt = buildRepairPrompt(
          1,
          1,
          [{
            id: "task-proof",
            passed: false,
            severity: "error",
            output: "Add the missing repair task file.",
          }],
          step,
          context.sandbox.artifactDir,
          false,
        );
        const repairResult = await antigravityCliAgentHarness.run({
          prompt: repairPrompt,
          model: "gemini-3.7-flash",
          effort: "xhigh",
          cwd: workspace,
          scopeRoot: root,
          agentWriteScope: [taskWriteScope],
          agentOutputDir: context.resources.agentDir,
          env: harnessEnvironment,
          resumeSessionId: "agy-initial",
          onMessage: (message) => {
            messages.push(message);
          },
        });
        expect(repairResult.isError).toBe(false);
        expect(readFileSync(join(workspace, "data/tasks/task-repair.md"), "utf8"))
          .toBe("repair turn edit\n");
        repairTurnPrompt = readFileSync(
          join(context.resources.agentDir, "repair-prompt.txt"),
          "utf8",
        );
        expect(readFileSync(
          join(context.resources.agentDir, "commit-message.txt"),
          "utf8",
        )).toBe("align native Git ownership\n");

        expect(git(workspace, "diff", "--cached", "--name-only")).toBe("");
        unstagedPaths = execFileSync(
          "git",
          ["status", "--short", "--untracked-files=all"],
          { cwd: workspace, encoding: "utf8" },
        ).trimEnd().split("\n").map((line) => line.slice(3));
        return { kind: "completed", commitMessage: "align native Git ownership" };
      },
    });

    const outcome = await lifecycle.execute(run, new AbortController().signal);

    expect(outcome).toEqual({ kind: "terminal", state: "succeeded" });
    expect(unstagedPaths).toEqual([
      "data/tasks/task-initial.md",
      "data/tasks/task-repair.md",
    ]);
    expect(readFileSync(join(root, "data/tasks/task-initial.md"), "utf8"))
      .toBe("initial turn edit\n");
    expect(readFileSync(join(root, "data/tasks/task-repair.md"), "utf8"))
      .toBe("repair turn edit\n");
    expect(git(root, "show", "--format=", "--name-only", "HEAD").split("\n"))
      .toEqual([
        "data/tasks/task-initial.md",
        "data/tasks/task-repair.md",
      ]);
    expect(readWriterIntegrationEvidence(join(root, ".kota", "runs"), run.id))
      .toMatchObject({
        commitMessage: "align native Git ownership",
        changedPaths: [
          "data/tasks/task-initial.md",
          "data/tasks/task-repair.md",
        ],
      });

    expect(occurrenceCount(
      initialPrompt,
      WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION,
    )).toBe(1);
    expect(occurrenceCount(
      repairTurnPrompt,
      WORKFLOW_AGENT_GIT_OWNERSHIP_INSTRUCTION,
    )).toBe(1);
    expect(repairTurnPrompt).toContain("Post-check repair attempt 1/1");

    const commandTraces = messages.flatMap((message) =>
      message.type === "status" && message.commandTrace !== undefined
        ? [message.commandTrace]
        : []
    );
    expect(commandTraces).toHaveLength(2);
    expect(kotaAgentCommandTraceMatches(
      commandTraces[0]!,
      "git status --short",
      "exact",
    )).toBe(true);
    expect(kotaAgentCommandTraceMatches(
      commandTraces[1]!,
      "git diff -- data/tasks/task-initial.md",
      "exact",
    )).toBe(true);
    for (const command of [
      "git add",
      "git commit",
      "git reset",
      "git checkout",
      "git switch",
      "git branch",
      "git merge",
      "git rebase",
      "git push",
    ]) {
      expect(commandTraces.some((trace) =>
        kotaAgentCommandTraceMatches(trace, command, "prefix")
      )).toBe(false);
    }
  });
});
