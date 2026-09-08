import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import {
  BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  type BlockedOwnerDecisionRequest,
  type BlockedOwnerDecisionResolution,
} from "./owner-decision-follow-up.js";
import { answerBlockedOwnerRequest } from "./owner-decision-test-support.js";
import blockedPromoterWorkflow from "./workflow.js";

function taskBody(question: string): string {
  return [
    "---",
    "status: blocked",
    "priority: p2",
    "---",
    "",
    "# Owner decision",
    "",
    "## Problem",
    "Owner input is required.",
    "",
    "## Blocked on",
    "",
    "```",
    "kind: owner-decision",
    "slot: remain-blocked",
    `question: ${question}`,
    "context: An affirmative free-form reply means keep the blocker in place.",
    "proposed_answers: keep-blocked, unblock",
    "```",
    "",
  ].join("\n");
}

function projectFixture(): { workspaceRoot: string; taskPath: string } {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "blocked-promoter-auth-"));
  writeFileSync(
    join(workspaceRoot, "package.json"),
    JSON.stringify({ scripts: { "validate-tasks": "true" } }),
  );
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  writeFileSync(join(workspaceRoot, "data", "tasks", "AGENTS.md"), "# tasks\n");
  writeFileSync(
    join(workspaceRoot, "data", "tasks", "archive", "AGENTS.md"),
    "# archive\n",
  );
  const taskPath = join(
    workspaceRoot,
    "data",
    "tasks",
    "task-owner-decision.md",
  );
  writeFileSync(taskPath, taskBody("Should this task remain blocked?"));
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "test"], { cwd: workspaceRoot });
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], {
    cwd: workspaceRoot,
  });
  return { workspaceRoot, taskPath };
}

async function resolveOwnerDecision(
  workspaceRoot: string,
  answer: string,
): Promise<BlockedOwnerDecisionResolution> {
  const requestRun = await new WorkflowScenarioDriver(blockedPromoterWorkflow, {
    trigger: { event: "autonomy.queue.available", payload: {} },
    workspaceRoot,
    ports: { runCommand: successfulWorkflowCommandRun },
  }).run();
  const request = requestRun.emitted.find(
    (event) => event.event === BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  )?.payload as BlockedOwnerDecisionRequest | undefined;
  if (!request) throw new Error("blocked promoter did not emit an owner request");
  const { resolution } = await answerBlockedOwnerRequest(workspaceRoot, request, answer);
  return resolution;
}

describe("blocked-promoter owner-decision authorization", () => {


  it.each(["yes", "approve"])(
    "keeps a negatively phrased task blocked after ambiguous '%s'",
    async (answer) => {
      const { workspaceRoot } = projectFixture();
      const resolution = await resolveOwnerDecision(workspaceRoot, answer);
      const result = await new WorkflowScenarioDriver(blockedPromoterWorkflow, {
        trigger: {
          event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
          payload: resolution,
        },
        workspaceRoot,
        ports: { runCommand: successfulWorkflowCommandRun },
      }).run();

      expect(result.status).toBe("success");
      const after = readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-owner-decision.md"),
        "utf-8",
      );
      expect(after).toContain("blocked-promoter-asked: slot=remain-blocked");
      expect(after).not.toContain("blocked-promoter-resolved");
      expect(existsSync(join(
        result.workspaceDir,
        "data",
        "tasks",
        "task-owner-decision.md",
      ))).toBe(true);
    },
  );

  it("fails closed when the precondition changes during the owner wait", async () => {
    const { workspaceRoot, taskPath } = projectFixture();
    const resolution = await resolveOwnerDecision(workspaceRoot, "unblock");
    writeFileSync(taskPath, taskBody("Which variant should we pick?"));
    execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "change precondition"], {
      cwd: workspaceRoot,
    });
    const result = await new WorkflowScenarioDriver(blockedPromoterWorkflow, {
      trigger: {
        event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
        payload: resolution,
      },
      workspaceRoot,
      ports: { runCommand: successfulWorkflowCommandRun },
    }).run();

    expect(result.status).toBe("failed");
    expect(result.steps["apply-ask-outcome"].error).toContain(
      "precondition changed while awaiting an answer",
    );
    const after = readFileSync(
      join(result.workspaceDir, "data", "tasks", "task-owner-decision.md"),
      "utf-8",
    );
    expect(after).not.toContain("blocked-promoter-asked");
    expect(after).not.toContain("blocked-promoter-resolved");
  });
});
