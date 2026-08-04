import { execFileSync, execSync, spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAgentRuntime } from "#core/model/preset.js";
import type {
  WorkflowStepContext,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import { unexpectedWorkflowAgentHarnessRun } from "#core/workflow/testing/agent-harness-runner.js";

export type CommitTestWorkspace = {
  tmpBase: string;
  projectDir: string;
  runDirPath: string;
};

type WorkflowStepStatuses = {
  [stepId: string]: WorkflowStepResult["status"];
};

type WorkflowStepOutputs = WorkflowStepContext["stepOutputs"];

export function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
}

export function makeCommitTestWorkspace(): CommitTestWorkspace {
  const tmpBase = join(
    tmpdir(),
    `kota-commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const projectDir = join(tmpBase, "project");
  const runDirPath = join(tmpBase, "run");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(runDirPath, { recursive: true });
  initGitRepo(projectDir);
  return { tmpBase, projectDir, runDirPath };
}

export function removeCommitTestWorkspace(workspace: CommitTestWorkspace): void {
  rmSync(workspace.tmpBase, { recursive: true, force: true });
}

export function removeFileSoon(path: string, delayMs: number): void {
  const script = [
    "const { rmSync } = require('node:fs');",
    `setTimeout(() => rmSync(${JSON.stringify(path)}, { force: true }), ${delayMs});`,
  ].join("");
  const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
  child.unref();
}

export function createNestedBareRepoWithHookConfig(dir: string): {
  bareDir: string;
  markerPath: string;
} {
  const bareDir = join(dir, "nested.git");
  const hooksDir = join(dir, "malicious-hooks");
  const markerPath = join(dir, "hook-marker");
  mkdirSync(hooksDir, { recursive: true });
  execFileSync("git", ["init", "--bare", bareDir], { cwd: dir, stdio: "ignore" });
  const hookPath = join(hooksDir, "pre-commit");
  writeFileSync(hookPath, `#!/bin/sh\necho hook-ran > ${JSON.stringify(markerPath)}\n`, "utf8");
  chmodSync(hookPath, 0o755);
  execFileSync("git", ["--git-dir", bareDir, "config", "core.hooksPath", hooksDir], {
    cwd: dir,
    stdio: "ignore",
  });
  return { bareDir, markerPath };
}

function makeStepResult(status: WorkflowStepResult["status"]): WorkflowStepResult {
  return { id: "", type: "tool", status, startedAt: "", completedAt: "", durationMs: 0 };
}

export function makeWorkflowStepContext(
  stepResults: WorkflowStepStatuses,
  stepOutputs: WorkflowStepOutputs = {},
): WorkflowStepContext {
  const results: Record<string, WorkflowStepResult> = {};
  for (const [id, status] of Object.entries(stepResults)) {
    results[id] = makeStepResult(status);
  }
  return {
    agentRuntime: resolveAgentRuntime(undefined),
    stepResults: results,
    stepOutputs,
    previousOutput: undefined,
    stepOutputList: [],
    projectDir: "/tmp",
    workflow: { name: "builder", definitionPath: "", runId: "", runDir: "", runDirPath: "" },
    trigger: { event: "", schemaRef: null, payload: {} },
    runAgentHarness: unexpectedWorkflowAgentHarnessRun,
    runTool: async () => ({ content: "" }),
    emit: () => {},
    requestRestart: () => {},
    readPrompt: () => "",
    readRuntimeState: () => ({ completedRuns: 0, pendingRuns: [], workflows: {} }),
    reportProgress: () => {},
    triggerWorkflow: async () => ({ runId: "", status: "queued" }),
  };
}
