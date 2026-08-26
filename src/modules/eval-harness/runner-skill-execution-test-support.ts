import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function completeTicketNormalization(params: {
  workingDir: string;
  valid: boolean;
  routing: string;
}): void {
  const readyPath = join(
    params.workingDir,
    "data",
    "tasks",
    "ready",
    "task-normalize-ticket-json.md",
  );
  const donePath = join(
    params.workingDir,
    "data",
    "tasks",
    "done",
    "task-normalize-ticket-json.md",
  );
  mkdirSync(join(params.workingDir, "data", "tasks", "done"), {
    recursive: true,
  });
  const taskText = readFileSync(readyPath, "utf-8");
  rmSync(readyPath, { force: true });
  writeFileSync(donePath, taskText.replace("status: ready", "status: done"));
  mkdirSync(join(params.workingDir, "output"), { recursive: true });
  writeFileSync(
    join(params.workingDir, "output", "ticket-summary.json"),
    JSON.stringify({ valid: params.valid, routing: params.routing }, null, 2),
  );
}

export function writeAgentStepArtifact(params: {
  workingDir: string;
  workflowName: string;
  agentStepId: string;
  promptText: string;
  inputTokens: number;
  outputTokens: number;
}): string {
  const runArtifactPath = join(
    params.workingDir,
    ".kota",
    "runs",
    params.workflowName,
  );
  const stepsDir = join(runArtifactPath, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(
    join(stepsDir, `${params.agentStepId}.input.md`),
    params.promptText,
  );
  writeFileSync(
    join(stepsDir, `${params.agentStepId}.json`),
    JSON.stringify(
      {
        usage: {
          tokens: {
            state: "complete",
            inputTokens: params.inputTokens,
            outputTokens: params.outputTokens,
          },
          cost: { state: "complete", usd: 0.01 },
        },
        output: {
          turns: 1,
          subtype: "success",
        },
      },
      null,
      2,
    ),
  );
  return runArtifactPath;
}
