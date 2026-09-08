import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, } from "vitest";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  readOperatorCaptureInstructedMarker,
  renderOperatorCaptureInstructedMarker,
  renderOwnerAskMarker,
  renderOwnerResolvedMarker,
} from "#modules/repo-tasks/blocked-precondition.js";
import {
  BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  BLOCKED_OWNER_DECISION_RESOLVED_EVENT,
  type BlockedOwnerDecisionRequest,
} from "./owner-decision-follow-up.js";
import { answerBlockedOwnerRequest } from "./owner-decision-test-support.js";
import blockedPromoterWorkflow from "./workflow.js";

async function runOwnerDecisionCycle(args: {
  workspaceRoot: string;
  answer: string;
}) {
  const requestRun = await runBlockedScenario(args.workspaceRoot, {
    event: "autonomy.queue.available", payload: {},
  });
  const request = requestRun.emitted.find(
    (event) => event.event === BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
  )?.payload as BlockedOwnerDecisionRequest | undefined;
  if (!request) throw new Error("blocked-promoter did not emit an owner request");
  const { resolution, questions } = await answerBlockedOwnerRequest(args.workspaceRoot, request, args.answer);
  const resolutionRun = await runBlockedScenario(args.workspaceRoot, {
    event: BLOCKED_OWNER_DECISION_RESOLVED_EVENT, payload: resolution,
  });
  return { requestRun, resolutionRun, questions };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const TASK_TEMPLATE = (
  id: string,
  preconditionSection: string,
  extras = "",
): string => {
  return [
    "---",
    "status: blocked",
    "priority: p2",
    "---",
    "",
    `# ${id}`,
    "",
    "## Problem",
    "Body.",
    "",
    "## Desired Outcome",
    "Outcome.",
    "",
    "## Constraints",
    "Constraints.",
    "",
    "## Done When",
    "- when",
    "",
    preconditionSection,
    "",
    "## Source / Intent",
    "Source.",
    "",
    "## Initiative",
    "Initiative paragraph.",
    "",
    "## Acceptance Evidence",
    "- Tests.",
    extras,
    "",
  ].join("\n");
};

function makeScopeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "blocked-promoter-wf-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { "validate-tasks": "true" } }),
  );
  writeFileSync(join(dir, ".gitignore"), ".kota/\n");
  mkdirSync(join(dir, "data", "tasks", "archive"), { recursive: true });
  writeFileSync(join(dir, "data", "tasks", "AGENTS.md"), "# tasks\n");
  writeFileSync(join(dir, "data", "tasks", "archive", "AGENTS.md"), "# archive\n");
  // Init a git repo so the moveTaskById helper's `git mv` calls succeed.
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function commitInitial(dir: string, committedAt?: string) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial", "--quiet"], {
    cwd: dir,
    env: committedAt
      ? { ...process.env, GIT_AUTHOR_DATE: committedAt, GIT_COMMITTER_DATE: committedAt }
      : process.env,
  });
}

function runBlockedScenario(
  workspaceRoot: string,
  trigger: Pick<WorkflowRunTrigger, "event" | "payload">,
) {
  return new WorkflowScenarioDriver(blockedPromoterWorkflow, {
    trigger,
    workspaceRoot,
    ports: { runCommand: successfulWorkflowCommandRun },
  }).run();
}

describe("blocked-promoter workflow", () => {


  it("auto-promotes tasks whose deterministic preconditions are satisfied", async () => {
    const workspaceRoot = makeScopeRoot();

    // operator-capture precondition with a proof artifact
    const completeCaptureDir = join(workspaceRoot, ".kota", "runs", "harness-parity-x");
    mkdirSync(completeCaptureDir, { recursive: true });
    writeFileSync(join(completeCaptureDir, "capture-proof.md"), "operator proof\n");
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-needs-capture.md"),
      TASK_TEMPLATE(
        "task-needs-capture",
        [
          "## Blocked on",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/harness-parity-*",
          "description: live captures",
          "```",
        ].join("\n"),
      ),
    );
    // capability-installed (storageState) precondition that does NOT match yet
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-needs-storage.md"),
      TASK_TEMPLATE(
        "task-needs-storage",
        [
          "## Blocked on",
          "",
          "```",
          "kind: capability-installed",
          "probe: storageState:.kota/auth.json",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(workspaceRoot);

    const result = await runBlockedScenario(workspaceRoot, {
      event: "autonomy.queue.available",
      payload: {},
    });

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    const promotion = result.steps["promote-deterministic"].output as {
      promotions: Array<{ id: string; toState: string }>;
    };
    const promotedIds = promotion.promotions.map((p) => p.id).sort();
    expect(promotedIds).toEqual(["task-needs-capture"]);
    // The task-needs-storage one stayed blocked (capability not present).
    expect(
      existsSync(
        join(result.workspaceDir, "data", "tasks", "task-needs-storage.md"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-needs-storage.md"),
        "utf-8",
      ),
    ).toContain("status: blocked");
    expect(
      existsSync(
        join(result.workspaceDir, "data", "tasks", "task-needs-capture.md"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-needs-capture.md"),
        "utf-8",
      ),
    ).toContain("status: open");
  });

  it("keeps a partial operator-capture directory blocked and refreshes instructions", async () => {
    const workspaceRoot = makeScopeRoot();
    const captureDir = join(workspaceRoot, ".kota", "runs", "telegram-deploy-staging");
    mkdirSync(captureDir, { recursive: true });
    writeFileSync(join(captureDir, "smoke.txt"), "daemon smoke test passed\n");
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-needs-telegram-proof.md"),
      TASK_TEMPLATE(
        "task-needs-telegram-proof",
        [
          "## Blocked on",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/telegram-deploy-staging",
          "description: staging bot /status message and bot reply",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(workspaceRoot);

    const result = await runBlockedScenario(workspaceRoot, {
      event: "autonomy.queue.available",
      payload: {},
    });

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    const promotion = result.steps["promote-deterministic"].output as {
      promotions: Array<{ id: string }>;
    };
    expect(promotion.promotions.map((p) => p.id)).not.toContain(
      "task-needs-telegram-proof",
    );
    expect(
      existsSync(
        join(result.workspaceDir, "data", "tasks", "task-needs-telegram-proof.md"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-needs-telegram-proof.md"),
        "utf-8",
      ),
    ).toContain("status: blocked");
    const instructions = (
      result.steps["instruct-operator-capture"].output as {
        instructions: Array<{ taskId: string; capturePath: string; reason: string }>;
      }
    ).instructions;
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toMatchObject({
      taskId: "task-needs-telegram-proof",
      capturePath: ".kota/runs/telegram-deploy-staging",
    });
    expect(instructions[0].reason).toContain("no operator-visible proof");
    const taskBody = readFileSync(
      join(result.workspaceDir, "data", "tasks", "task-needs-telegram-proof.md"),
      "utf-8",
    );
    expect(readOperatorCaptureInstructedMarker(taskBody)).not.toBeNull();
    const artifactPath = (
      result.steps["write-blocker-actions"].output as { path: string }
    ).path;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      actions: Array<{ kind: string; taskId: string; reason?: string }>;
      operatorCaptureInstructionsEmitted: Array<{
        taskId: string;
        capturePath: string;
      }>;
    };
    expect(artifact.actions[0]).toMatchObject({
      kind: "operator-capture-due",
      taskId: "task-needs-telegram-proof",
    });
    expect(artifact.actions[0].reason).toContain("no operator-visible proof");
    expect(artifact.operatorCaptureInstructionsEmitted[0]).toMatchObject({
      taskId: "task-needs-telegram-proof",
      capturePath: ".kota/runs/telegram-deploy-staging",
    });
  });

  it("re-asks the owner for a due owner-decision and promotes on approval", async () => {
    const workspaceRoot = makeScopeRoot();
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Blocked on",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant should we pick?",
          "context: Variants A, B, hybrid sketched in body.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(workspaceRoot);

    const { requestRun, resolutionRun: result } =
      await runOwnerDecisionCycle({ workspaceRoot, answer: "unblock" });

    expect(requestRun.status).toBe("success");
    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    const followups = (
      result.steps["promote-after-approval"].output as {
        promotions: Array<{ id: string }>;
      }
    ).promotions;
    expect(followups.map((p) => p.id)).toContain("task-pick-variant");
    expect(
      existsSync(
        join(result.workspaceDir, "data", "tasks", "task-pick-variant.md"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-pick-variant.md"),
        "utf-8",
      ),
    ).toContain("status: open");
  });

  it("refreshes the asked marker on a non-approval answer without promoting", async () => {
    const workspaceRoot = makeScopeRoot();
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Blocked on",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: Variants A, B, hybrid sketched in body.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(workspaceRoot);

    const { resolutionRun: result } = await runOwnerDecisionCycle({
      workspaceRoot,
      answer: "still thinking",
    });

    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    const taskBody = readFileSync(
      join(result.workspaceDir, "data", "tasks", "task-pick-variant.md"),
      "utf-8",
    );
    expect(taskBody).toContain("blocked-promoter-asked: slot=pick-variant");
    expect(taskBody).not.toContain("blocked-promoter-resolved");
  });

  it("skips owner ask when the marker is fresher than 14 days", async () => {
    const workspaceRoot = makeScopeRoot();
    const recentMarker = renderOwnerAskMarker({
      slot: "pick-variant",
      lastAskedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Blocked on",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: ctx.",
          "proposed_answers: variant-a",
          "```",
        ].join("\n"),
        recentMarker,
      ),
    );
    commitInitial(workspaceRoot);

    const result = await runBlockedScenario(workspaceRoot, {
      event: "autonomy.queue.available",
      payload: {},
    });
    expect(result.status, JSON.stringify(result, null, 2)).toBe("success");
    expect(
      result.emitted.filter(
        (event) => event.event === BLOCKED_OWNER_DECISION_REQUESTED_EVENT,
      ),
    ).toHaveLength(0);
  });

  it("instructs an aged operator-capture blocker and writes the run artifact", async () => {
    const workspaceRoot = makeScopeRoot();
    const oldUpdatedAt = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-aged-capture.md"),
      TASK_TEMPLATE(
        "task-aged-capture",
        [
          "## Blocked on",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/peer-cli-comparison",
          "description: peer-CLI captures",
          "```",
        ].join("\n"),
        "",
      ),
    );
    utimesSync(
      join(workspaceRoot, "data", "tasks", "task-aged-capture.md"),
      new Date(oldUpdatedAt),
      new Date(oldUpdatedAt),
    );
    commitInitial(workspaceRoot, oldUpdatedAt);

    const result = await runBlockedScenario(workspaceRoot, {
      event: "autonomy.queue.available",
      payload: {},
    });

    expect(result.status).toBe("success");
    const instructions = (
      result.steps["instruct-operator-capture"].output as {
        instructions: Array<{ taskId: string; capturePath: string }>;
      }
    ).instructions;
    expect(instructions.map((i) => i.taskId)).toEqual(["task-aged-capture"]);
    // The marker is written to the task body.
    const body = readFileSync(
      join(result.workspaceDir, "data", "tasks", "task-aged-capture.md"),
      "utf-8",
    );
    expect(readOperatorCaptureInstructedMarker(body)).not.toBeNull();
    const artifactPath = (
      result.steps["write-blocker-actions"].output as {
        path: string;
      }
    ).path;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      actions: Array<{ kind: string; taskId: string }>;
      operatorCaptureInstructionsEmitted: Array<{ taskId: string; capturePath: string }>;
    };
    expect(artifact.actions[0].kind).toBe("operator-capture-due");
    expect(artifact.operatorCaptureInstructionsEmitted[0].capturePath).toBe(
      ".kota/runs/peer-cli-comparison",
    );
  });

  it("does not re-instruct an aged operator-capture within the cadence", async () => {
    const workspaceRoot = makeScopeRoot();
    const oldUpdatedAt = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
    const recentMarker = renderOperatorCaptureInstructedMarker({
      lastInstructedAt: new Date(Date.now() - 1 * MS_PER_DAY).toISOString(),
    });
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-aged-capture.md"),
      TASK_TEMPLATE(
        "task-aged-capture",
        [
          "## Blocked on",
          "",
          "```",
          "kind: operator-capture",
          "path: .kota/runs/peer-cli-comparison",
          "description: peer-CLI captures",
          "```",
        ].join("\n"),
        recentMarker,
      ),
    );
    utimesSync(
      join(workspaceRoot, "data", "tasks", "task-aged-capture.md"),
      new Date(oldUpdatedAt),
      new Date(oldUpdatedAt),
    );
    commitInitial(workspaceRoot, oldUpdatedAt);

    const result = await runBlockedScenario(workspaceRoot, {
      event: "autonomy.queue.available",
      payload: {},
    });
    const artifactPath = (
      result.steps["write-blocker-actions"].output as { path: string }
    ).path;
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      actions: Array<{ kind: string }>;
      operatorCaptureInstructionsEmitted: unknown[];
    };
    expect(artifact.actions[0].kind).toBe("operator-capture-recent");
    expect(artifact.operatorCaptureInstructionsEmitted).toHaveLength(0);
  });

  it("surfaces the recommended option in the owner-ask question", async () => {
    const workspaceRoot = makeScopeRoot();
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Blocked on",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: Recommended: variant-a. Rationale: x.",
          "proposed_answers: variant-a, variant-b, hybrid, unblock",
          "```",
        ].join("\n"),
      ),
    );
    commitInitial(workspaceRoot);

    const { questions } = await runOwnerDecisionCycle({ workspaceRoot, answer: "variant-a" });
    expect(questions).toHaveLength(1);
    expect(questions[0].proposedAnswers?.[0]).toBe("variant-a");
    expect(questions[0].context).toContain("Recommended option: variant-a");
  });

  it("promotes already-resolved owner-decision tasks deterministically", async () => {
    const workspaceRoot = makeScopeRoot();
    const resolvedMarker = renderOwnerResolvedMarker({
      slot: "pick-variant",
      resolvedAt: "2026-04-24T00:00:00.000Z",
    });
    writeFileSync(
      join(workspaceRoot, "data", "tasks", "task-pick-variant.md"),
      TASK_TEMPLATE(
        "task-pick-variant",
        [
          "## Blocked on",
          "",
          "```",
          "kind: owner-decision",
          "slot: pick-variant",
          "question: Which variant?",
          "context: ctx.",
          "proposed_answers: variant-a",
          "```",
        ].join("\n"),
        resolvedMarker,
      ),
    );
    commitInitial(workspaceRoot);

    const result = await runBlockedScenario(workspaceRoot, {
      event: "autonomy.queue.available",
      payload: {},
    });
    const promotion = result.steps["promote-deterministic"].output as {
      promotions: Array<{ id: string }>;
    };
    expect(promotion.promotions.map((p) => p.id)).toContain("task-pick-variant");
    expect(
      existsSync(
        join(result.workspaceDir, "data", "tasks", "task-pick-variant.md"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        join(result.workspaceDir, "data", "tasks", "task-pick-variant.md"),
        "utf-8",
      ),
    ).toContain("status: open");
  });
});
