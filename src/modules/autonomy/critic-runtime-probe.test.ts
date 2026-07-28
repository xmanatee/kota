import "./critic-test-fixture.integration.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createCriticCheck } from "./critic.js";
import {
  type CodeCheck,
  commitReadyTask,
  getMockRunAgentHarness,
  getPromptArg,
  makeContext,
  makeRunDir,
  makeTmpDir,
  moveReadyTaskToDoing,
  resetCriticTestMocks,
  setApiResponse,
  TEST_PARENT_STEP,
  writeDoingTask,
  writePackageJson,
} from "./critic-test-fixture.integration.js";

const mockRunAgentHarness = getMockRunAgentHarness();

describe("critic runtime probes", () => {
  beforeEach(resetCriticTestMocks);

  it("runs a trusted task probe and threads the result into the critic prompt", async () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:pass": "node -e \"console.log('probe-output-marker')\"",
    });
    const taskContent = [
      "---",
      "title: Probed task",
      "---",
      "## Runtime Probe",
      "command: pnpm run probe:pass",
      "timeoutMs: 5000",
    ].join("\n");
    commitReadyTask(dir, "task-probed.md", taskContent);
    moveReadyTaskToDoing(dir, "task-probed.md");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Probe passed.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);

    const artifact = JSON.parse(readFileSync(join(runDir, "runtime-probe.json"), "utf8"));
    expect(artifact.verdict).toBe("pass");
    expect(artifact.exitCode).toBe(0);
    expect(artifact.probe.command).toBe("pnpm run probe:pass");
    expect(artifact.provenance).toEqual({
      status: "trusted",
      kind: "git-head",
      sourcePath: "data/tasks/ready/task-probed.md",
    });
    expect(artifact.output).toContain("probe-output-marker");
    expect(artifact.execution).toBe("os-contained-command");
    expect(artifact.isolation).toEqual({
      status: "enforced",
      kind: "linux-bubblewrap",
      processBoundary: "pid-namespace",
      evidence: "test process boundary",
    });

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("## Runtime Probe Result");
    expect(userMessage).toContain("Command: pnpm run probe:pass");
    expect(userMessage).toContain("Provenance: trusted");
    expect(userMessage).toContain("Isolation: enforced");
  });

  it("writes builder probe evidence into the active workspace run directory", async () => {
    const canonicalDir = makeTmpDir();
    const workspaceDir = makeTmpDir();
    writePackageJson(workspaceDir, {
      "probe:pass": "node -e \"console.log('workspace-probe')\"",
    });
    const taskContent = [
      "---",
      "title: Workspace probe",
      "---",
      "## Runtime Probe",
      "command: pnpm run probe:pass",
      "timeoutMs: 5000",
    ].join("\n");
    commitReadyTask(workspaceDir, "task-workspace-probe.md", taskContent);
    moveReadyTaskToDoing(workspaceDir, "task-workspace-probe.md");
    const canonicalRunDir = makeRunDir(canonicalDir);
    const workspaceRunDir = makeRunDir(workspaceDir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Workspace probe passed.",
    });

    const check = createCriticCheck();
    await (check as CodeCheck).run(
      makeContext(canonicalDir, canonicalRunDir, workspaceDir, workspaceRunDir),
      TEST_PARENT_STEP,
    );

    expect(existsSync(join(workspaceRunDir, "runtime-probe.json"))).toBe(true);
    expect(existsSync(join(canonicalRunDir, "runtime-probe.json"))).toBe(false);
  });

  it("writes ignored workspace probe evidence for builder-owned staging", async () => {
    const canonicalDir = makeTmpDir();
    const workspaceDir = makeTmpDir();
    writePackageJson(workspaceDir, {
      "probe:touch":
        "node -e \"require('node:fs').writeFileSync('probe-ran.txt', 'yes')\"",
    });
    const taskContent = [
      "---",
      "title: Ignored workspace probe",
      "---",
      "## Runtime Probe",
      "command: pnpm run probe:touch",
      "timeoutMs: 5000",
    ].join("\n");
    commitReadyTask(workspaceDir, "task-ignored-probe.md", taskContent);
    moveReadyTaskToDoing(workspaceDir, "task-ignored-probe.md");
    writeFileSync(join(workspaceDir, ".gitignore"), ".kota/\n");
    const canonicalRunDir = makeRunDir(canonicalDir);
    const workspaceRunDir = makeRunDir(workspaceDir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "Ignored probe evidence is preserved by the builder commit path.",
    });

    const check = createCriticCheck();
    await (check as CodeCheck).run(
      makeContext(canonicalDir, canonicalRunDir, workspaceDir, workspaceRunDir),
      TEST_PARENT_STEP,
    );

    expect(existsSync(join(workspaceDir, "probe-ran.txt"))).toBe(true);
    expect(existsSync(join(workspaceRunDir, "runtime-probe.json"))).toBe(true);
    expect(mockRunAgentHarness).toHaveBeenCalledOnce();
  });

  it("records a failing probe verdict and surfaces the failure in the critic prompt", async () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:fail": "node -e \"console.error('nope'); process.exit(7)\"",
    });
    const taskContent = [
      "---",
      "title: Failing probe task",
      "---",
      "## Runtime Probe",
      "command: pnpm run probe:fail",
      "timeoutMs: 5000",
    ].join("\n");
    commitReadyTask(dir, "task-probe-fail.md", taskContent);
    moveReadyTaskToDoing(dir, "task-probe-fail.md");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "fail",
      critical_issues: ["Runtime probe failed"],
      warnings: [],
      summary: "Probe fail surfaced as critical.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP)).rejects.toThrow(/critical issue/);

    const artifact = JSON.parse(readFileSync(join(runDir, "runtime-probe.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.exitCode).toBe(7);
    expect(artifact.output).toContain("nope");

    const userMessage = getPromptArg(mockRunAgentHarness.mock.calls[0]);
    expect(userMessage).toContain("Verdict: fail");
    expect(userMessage).toContain("Exit code: 7");
  });

  it("rejects a runtime probe added during the build before executing it", async () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      "probe:touch": "node -e \"require('node:fs').writeFileSync('probe-ran.txt', 'yes')\"",
    });
    commitReadyTask(
      dir,
      "task-added-probe.md",
      "---\ntitle: Probe added later\n---\n## Problem\nNo trusted probe yet.",
    );
    moveReadyTaskToDoing(dir, "task-added-probe.md");
    writeFileSync(
      join(dir, "data/tasks/doing/task-added-probe.md"),
      "---\ntitle: Probe added later\n---\n## Runtime Probe\ncommand: pnpm run probe:touch\ntimeoutMs: 5000",
    );
    const runDir = makeRunDir(dir);

    const check = createCriticCheck({ runDirPath: runDir });
    await expect((check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP)).rejects.toThrow(/not executed/);

    expect(existsSync(join(dir, "probe-ran.txt"))).toBe(false);
    expect(mockRunAgentHarness).not.toHaveBeenCalled();
    const artifact = JSON.parse(readFileSync(join(runDir, "runtime-probe.json"), "utf8"));
    expect(artifact.verdict).toBe("fail");
    expect(artifact.output).toContain("not executed");
    expect(artifact.provenance.status).toBe("untrusted");
  });

  it("does not write runtime-probe.json when the task has no probe section", async () => {
    const dir = makeTmpDir();
    writeDoingTask(dir, "task-noprobe.md", "---\ntitle: No probe\n---\nBody.");
    const runDir = makeRunDir(dir);
    setApiResponse({
      verdict: "pass",
      critical_issues: [],
      warnings: [],
      summary: "No probe needed.",
    });

    const check = createCriticCheck({ runDirPath: runDir });
    const result = await (check as CodeCheck).run(makeContext(dir, runDir), TEST_PARENT_STEP);
    expect(result).toMatch(/pass/);
    expect(existsSync(join(runDir, "runtime-probe.json"))).toBe(false);
    expect(getPromptArg(mockRunAgentHarness.mock.calls[0])).not.toContain("## Runtime Probe Result");
  });
});
