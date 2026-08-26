import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeWriterIntegrationFixture } from "#core/workflow/testing/writer-integration-fixture.js";
import type { FixtureJsonValue } from "./fixture-common-types.js";

export type AgentStepArtifact = {
  id: string;
  type: "agent" | "code";
  output?: {
    content?: FixtureJsonValue;
    subtype?: string;
    turns?: number;
    totalCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    sessionId?: string;
  };
};

export function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  execSync("git config commit.gpgsign false", { cwd: dir });
}

export function writeFile(dir: string, path: string, content: string): void {
  const abs = join(dir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

export function seedSourceRun(
  projectDir: string,
  runId: string,
  workflowName: string,
  stepId: string,
  stepArtifact: AgentStepArtifact,
  events: readonly string[],
): string {
  const runDir = join(projectDir, ".kota", "runs", runId);
  mkdirSync(join(runDir, "steps"), { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({ id: runId, workflow: workflowName }),
  );
  writeFileSync(
    join(runDir, "steps", `${stepId}.json`),
    JSON.stringify(stepArtifact),
  );
  writeFileSync(
    join(runDir, "steps", `${stepId}.events.jsonl`),
    events.join("\n"),
  );
  return runDir;
}

export function seedWriterIntegration(
  projectDir: string,
  runId: string,
  params: { publishedHead: string; message: string },
): void {
  const integratedFromHead = execFileSync(
    "git",
    ["rev-parse", `${params.publishedHead}^`],
    { cwd: projectDir, encoding: "utf-8" },
  ).trim();
  const changedPaths = execFileSync(
    "git",
    ["diff", "--name-only", integratedFromHead, params.publishedHead],
    { cwd: projectDir, encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  writeWriterIntegrationFixture(join(projectDir, ".kota", "runs"), {
    runId,
    workflow: "fixture-workflow",
    baseHead: integratedFromHead,
    integratedFromHead,
    publishedHead: params.publishedHead,
    commitSubject: params.message,
    commitMessage: params.message,
    changedPaths,
  });
}

export function defaultAgentStep(stepId: string): AgentStepArtifact {
  return {
    id: stepId,
    type: "agent",
    output: {
      content: "ok",
      subtype: "success",
      turns: 1,
      totalCostUsd: 0,
      inputTokens: 1,
      outputTokens: 1,
    },
  };
}
