import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { makeStubEventProxy } from "#core/modules/testing/index.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  loadAutonomyWorkflowDefinitions,
  seedIssueDrivenLoopFixture,
  waitUntil,
} from "./autonomous-loop.integration-test-helpers.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../claude-agent-harness/executor.js");
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);

describe("issue-driven owner-answer lifecycle integration", () => {
  let projectDir: string;
  let savedPreset: string | undefined;

  beforeEach(() => {
    savedPreset = process.env[PRESET_ENV_VAR];
    process.env[PRESET_ENV_VAR] = "claude";
    projectDir = join(
      tmpdir(),
      `kota-owner-answer-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    seedIssueDrivenLoopFixture(projectDir);
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (savedPreset === undefined) delete process.env[PRESET_ENV_VAR];
    else process.env[PRESET_ENV_VAR] = savedPreset;
  });

  it(
    "returns an owner answer to the originating issue and updates its stable proposal",
    { timeout: 30_000 },
    async () => {
      const dispositions = [
        {
          action: "ask-owner",
          rationale: "The recovery policy is an owner decision.",
          taskTitle: "",
          taskSummary: "",
          taskPriority: "p1",
          taskArea: "",
          taskClass: "Product",
          taskAcceptanceEvidence: "",
          ownerQuestion: "Should builder preserve the failed run's worktree?",
          ownerReason: "Both recovery policies are technically valid.",
          proposedAnswers: ["Preserve the worktree", "Release the claim"],
        },
        {
          action: "create-task",
          rationale: "The owner selected worktree preservation.",
          taskTitle: "Preserve failed builder worktrees",
          taskSummary: "Apply the owner-selected recovery policy through builder.",
          taskPriority: "p1",
          taskArea: "autonomy",
          taskClass: "Product",
          taskAcceptanceEvidence:
            "A lifecycle fixture preserves the worktree after the same failure.",
          ownerQuestion: "",
          ownerReason: "",
          proposedAnswers: [],
        },
      ] as const;
      for (const disposition of dispositions) {
        mockedExecuteWithAgentSDK.mockResolvedValueOnce({
          text: ["```json", JSON.stringify(disposition), "```"].join("\n"),
          streamedText: "",
          turns: 1,
          totalCostUsd: 0.01,
          subtype: "success",
          isError: false,
        } as never);
      }

      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, deriveDirectoryScopeId(projectDir));
      subscribeAutonomyIssueSources({ cwd: projectDir, events: makeStubEventProxy(bus) });
      const completed: string[] = [];
      bus.on("workflow.completed", (payload) => {
        if (payload.workflow === "improver") completed.push(payload.runId);
      });
      const workflowDefinitions = await loadAutonomyWorkflowDefinitions();
      const runtime = new WorkflowRuntime({
        config: {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
        },
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows: workflowDefinitions.filter((workflow) =>
          workflow.name === "autonomy-health-reviewer" ||
          workflow.name === "improver"
        ),
      });
      runtime.start();
      try {
        pbus.emit("workflow.failure.alert", {
          workflow: "builder",
          runId: "owner-policy-failure",
          status: "failed",
          durationMs: 1_000,
          errorSummary: "Builder recovery policy is undecided",
          text: "builder failed",
        });
        await waitUntil(
          () => {
            const issue = readAutonomyIssueProjection(projectDir).issues[0];
            return issue?.disposition.kind === "owner-question" &&
              issue.links.ownerQuestionIds.length === 1;
          },
          "the owner-question disposition",
        );
        const firstIssue = readAutonomyIssueProjection(projectDir).issues[0]!;
        const questionId = firstIssue.links.ownerQuestionIds[0]!;
        const questions = new OwnerQuestionQueue(
          join(projectDir, ".kota", "owner-questions"),
          pbus,
        );

        questions.answer(questionId, "Preserve the worktree", "fixture-owner");
        await waitUntil(
          () =>
            completed.length === 2 &&
            readAutonomyIssueProjection(projectDir).issues[0]
              ?.disposition.kind === "task",
          "the answer-driven task disposition",
        );

        const projection = readAutonomyIssueProjection(projectDir);
        const tasks = listFullRepoTasks(projectDir);
        expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(2);
        expect(projection.issues).toEqual([
          expect.objectContaining({
            issueKey: firstIssue.issueKey,
            rootCauseKey: firstIssue.rootCauseKey,
            semanticRevision: 2,
            status: "open",
            links: expect.objectContaining({
              taskIds: [tasks[0]!.id],
              ownerQuestionIds: [],
            }),
          }),
        ]);
        expect(tasks).toEqual([
          expect.objectContaining({
            state: "ready",
            body: expect.stringContaining(
              `Proposal key: \`autonomy-issue:${firstIssue.issueKey}\``,
            ),
          }),
        ]);
        expect(questions.get(questionId)).toMatchObject({
          status: "answered",
          answer: "Preserve the worktree",
        });
      } finally {
        await runtime.stop();
      }
    },
  );
});
