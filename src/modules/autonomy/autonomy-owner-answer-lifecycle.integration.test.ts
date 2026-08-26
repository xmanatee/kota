import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pricedAgentUsage } from "#core/agent-harness/usage.js";
import { createWorkflowDispatchDeadLetter } from "#core/daemon/dead-letter-queue.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  loadAutonomyWorkflowDefinitions,
  seedIssueDrivenLoopFixture,
  waitUntil,
} from "./autonomous-loop.integration-test-helpers.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import { makeAutonomyIssueSourceContext } from "./autonomy-issue-sources.test-helpers.js";
import { createTestWorkflowRuntime } from "./autonomy-runtime.test-helpers.js";

vi.mock("#modules/claude-agent-harness/executor.js", async () => {
  const actual = await vi.importActual("../claude-agent-harness/executor.js");
  return { ...actual, executeWithAgentSDK: vi.fn() };
});

import "#modules/claude-agent-harness/index.js";

const mockedExecuteWithAgentSDK = vi.mocked(executeWithAgentSDK);
const INTEGRATION_WAIT_MS = 45_000;

function waitForLifecycle(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  return waitUntil(predicate, description, INTEGRATION_WAIT_MS);
}

describe("issue-driven owner-answer lifecycle integration", () => {
  let workspaceRoot: string;
  let savedPreset: string | undefined;

  beforeEach(() => {
    savedPreset = process.env[PRESET_ENV_VAR];
    process.env[PRESET_ENV_VAR] = "claude";
    workspaceRoot = join(
      tmpdir(),
      `kota-owner-answer-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    seedIssueDrivenLoopFixture(workspaceRoot);
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
    if (savedPreset === undefined) delete process.env[PRESET_ENV_VAR];
    else process.env[PRESET_ENV_VAR] = savedPreset;
  });

  it(
    "returns an owner answer to the originating issue and updates its stable proposal",
    { timeout: 90_000 },
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
          taskHowWeWillKnow: "",
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
          taskHowWeWillKnow:
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
          usage: pricedAgentUsage(undefined, undefined, 0.01),
          subtype: "success",
          isError: false,
        } as never);
      }

      const bus = new EventBus();
      const pbus = new ScopedEventBus(bus, deriveDirectoryScopeId(workspaceRoot));
      const source = makeAutonomyIssueSourceContext(
        workspaceRoot,
        bus,
        deriveDirectoryScopeId(workspaceRoot),
      );
      subscribeAutonomyIssueSources(source.ctx);
      const completed: string[] = [];
      bus.on("workflow.completed", (payload) => {
        if (payload.workflow === "improver") completed.push(payload.runId);
      });
      const workflowDefinitions = await loadAutonomyWorkflowDefinitions();
      const runtimeFixture = createTestWorkflowRuntime({
        config: {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
        },
        bus,
        scopeRoot: workspaceRoot,
        idleIntervalMs: 10,
        workflows: workflowDefinitions.filter((workflow) =>
          workflow.name === "autonomy-health-reviewer" ||
          workflow.name === "autonomy-issue-projection-materialization" ||
          workflow.name === "improver" ||
          workflow.name === "improver-disposition-publication"
        ),
      });
      const { runtime } = runtimeFixture;
      runtime.start();
      try {
        createWorkflowDispatchDeadLetter({
          store: source.runtime.deadLetterQueue,
          scopeId: deriveDirectoryScopeId(workspaceRoot),
          workflowName: "builder",
          trigger: {
            event: "autonomy.queue.available",
            schemaRef: null,
            payload: {},
          },
          reason: "Builder recovery policy is undecided",
          errorClass: "execution",
          failedRun: {
            id: "owner-policy-failure",
            workflow: "builder",
            definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
            trigger: {
              event: "autonomy.queue.available",
              schemaRef: null,
              payload: {},
            },
            startedAt: "2026-08-14T02:00:00.000Z",
            completedAt: "2026-08-14T02:01:00.000Z",
            status: "failed",
            runDir: ".kota/runs/owner-policy-failure",
            steps: [],
          },
        });
        await waitForLifecycle(
          () => {
            const issue = readAutonomyIssueProjection(workspaceRoot).issues[0];
            return issue?.disposition.kind === "owner-question" &&
              issue.links.ownerQuestionIds.length === 1;
          },
          "the owner-question disposition",
        );
        const firstIssue = readAutonomyIssueProjection(workspaceRoot).issues[0]!;
        const questionId = firstIssue.links.ownerQuestionIds[0]!;
        const questions = new OwnerQuestionQueue(
          join(workspaceRoot, ".kota", "owner-questions"),
          pbus,
        );

        questions.answer(questionId, "Preserve the worktree", "fixture-owner");
        await waitForLifecycle(
          () =>
            completed.length === 2 &&
            readAutonomyIssueProjection(workspaceRoot).issues[0]
              ?.disposition.kind === "task",
          "the answer-driven task disposition",
        );

        const projection = readAutonomyIssueProjection(workspaceRoot);
        const tasks = listFullRepoTasks(workspaceRoot);
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
        await runtimeFixture.stop();
        source.runtime.runState.close();
      }
    },
  );
});
