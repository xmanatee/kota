import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowDispatchDeadLetter } from "#core/daemon/dead-letter-queue.js";
import {
  EventedDeadLetterQueueStore,
  projectScopedDeadLetterChangedPublisher,
} from "#core/daemon/dead-letter-queue-events.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import repoTaskMutationWorkflow from "#modules/repo-tasks/repo-task-mutation-workflow.js";
import {
  getRepoTaskQueueSnapshot,
  listFullRepoTasks,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  loadAutonomyWorkflowDefinitions,
  seedIssueDrivenLoopFixture,
  waitUntil,
} from "./autonomous-loop.integration-test-helpers.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import { makeAutonomyIssueSourceContext } from "./autonomy-issue-sources.test-helpers.js";
import { createTestWorkflowRuntime } from "./autonomy-runtime.test-helpers.js";
import { autonomyHealthSignal, normalizeHealthSignal } from "./health-signal.js";

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

describe("issue-driven autonomy lifecycle integration", () => {
  let projectDir: string;
  let savedPreset: string | undefined;

  beforeEach(() => {
    savedPreset = process.env[PRESET_ENV_VAR];
    process.env[PRESET_ENV_VAR] = "claude";
    projectDir = join(
      tmpdir(),
      `kota-issue-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    "routes one failure through issue review, generated work, builder eligibility, and explicit clear",
    { timeout: 90_000 },
    async () => {
      const failureReason =
        'Agent harness "codex" cannot honor requested run option(s): autonomyMode="passive". autonomyMode="passive": Codex CLI native tool calls cannot be classified and denied individually under KOTA\'s passive contract.';
      const disposition = {
        action: "create-task",
        rationale: "The repeated static capability failure needs one builder repair.",
        taskTitle: "Repair passive Codex workflow compatibility",
        taskSummary: "Keep incompatible native harness contracts out of dispatch.",
        taskPriority: "p1",
        taskArea: "autonomy",
        taskClass: "Product",
        taskAcceptanceEvidence:
          "A production-shaped lifecycle fixture reaches a typed clear without another AI review.",
        ownerQuestion: "",
        ownerReason: "",
        proposedAnswers: [],
      } as const;
      mockedExecuteWithAgentSDK.mockResolvedValue({
        text: ["```json", JSON.stringify(disposition), "```"].join("\n"),
        streamedText: "",
        turns: 1,
        totalCostUsd: 0.01,
        subtype: "success",
        isError: false,
      } as never);

      const bus = new EventBus();
      const pbus = new ProjectScopedEventBus(bus, deriveDirectoryScopeId(projectDir));
      const source = makeAutonomyIssueSourceContext(
        projectDir, bus, deriveDirectoryScopeId(projectDir),
      );
      subscribeAutonomyIssueSources(source.ctx);
      const completed: Array<{
        workflow: string;
        status: string;
        runDir: string;
      }> = [];
      const queueAvailable: string[] = [];
      const attention: string[] = [];
      bus.on("workflow.completed", (payload) => completed.push({
        workflow: payload.workflow,
        status: payload.status,
        runDir: payload.runDir,
      }));
      bus.on("autonomy.queue.available", (payload) => {
        queueAvailable.push(payload.taskId);
      });
      bus.on("workflow.attention.digest", (payload) => attention.push(payload.text));

      const workflowDefinitions = [
        ...await loadAutonomyWorkflowDefinitions(),
        {
          ...repoTaskMutationWorkflow,
          definitionPath: "src/modules/repo-tasks/repo-task-mutation-workflow.ts",
          moduleRoot: projectDir,
        },
      ];
      const createRuntime = (workflowNames: string[]) => createTestWorkflowRuntime({
        config: {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
        },
        bus,
        projectDir,
        idleIntervalMs: 10,
        workflows: workflowDefinitions.filter((workflow) =>
          workflowNames.includes(workflow.name)
        ),
      });

      const issueRuntime = createRuntime([
        "autonomy-health-reviewer",
        "autonomy-health-review-publication",
        "autonomy-issue-projection-materialization",
        "improver",
        "improver-disposition-publication",
      ]);
      issueRuntime.runtime.start();
      try {
        pbus.emit("workflow.failure.alert", {
          workflow: "progress-reviewer",
          runId: "2026-08-06T12-00-00-031Z-progress-reviewer-zrvmul",
          status: "failed",
          durationMs: 1_000,
          errorSummary: failureReason,
          text: "progress-reviewer failed",
        });

        await waitForLifecycle(
          () => completed.some((run) => run.workflow === "improver"),
          "the improver disposition",
        );
        const improverRun = completed.find((run) => run.workflow === "improver")!;
        const improverMetadata = JSON.parse(
          readFileSync(join(projectDir, improverRun.runDir, "metadata.json"), "utf-8"),
        ) as { status: string };
        if (improverMetadata.status !== "success") {
          throw new Error(JSON.stringify(improverMetadata, null, 2));
        }

        const deadLetters = new EventedDeadLetterQueueStore(
          join(projectDir, ".kota", "dead-letter-queue"),
          () => new Date("2026-08-14T02:00:00.000Z"),
          projectScopedDeadLetterChangedPublisher(pbus),
        );
        const deadLetter = createWorkflowDispatchDeadLetter({
          store: deadLetters,
          scopeId: deriveDirectoryScopeId(projectDir),
          workflowName: "progress-reviewer",
          trigger: {
            event: "autonomy.progress-review.requested",
            schemaRef: null,
            payload: {},
          },
          reason: failureReason,
          errorClass: "execution",
          failedRun: {
            id: "2026-08-06T12-00-00-031Z-progress-reviewer-zrvmul",
            workflow: "progress-reviewer",
            definitionPath:
              "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
            trigger: {
              event: "autonomy.progress-review.requested",
              schemaRef: null,
              payload: {},
            },
            startedAt: "2026-08-06T12:00:00.000Z",
            completedAt: "2026-08-06T12:01:00.000Z",
            status: "failed",
            runDir:
              ".kota/runs/2026-08-06T12-00-00-031Z-progress-reviewer-zrvmul",
            steps: [],
          },
        });
        await waitForLifecycle(
          () =>
            readAutonomyIssueProjection(projectDir).issues[0]
              ?.links.deadLetterIds.includes(deadLetter.id) === true,
          "the later dead-letter evidence to enrich the original issue",
        );
        expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
        expect(readAutonomyIssueProjection(projectDir).issues).toEqual([
          expect.objectContaining({
            semanticRevision: 1,
            links: expect.objectContaining({ deadLetterIds: [deadLetter.id] }),
          }),
        ]);
      } finally {
        await issueRuntime.stop();
      }

      const dispatcherRuntime = createRuntime(["dispatcher"]);
      const queueSnapshot = getRepoTaskQueueSnapshot(projectDir);
      if (queueSnapshot.actionableCount !== 1) {
        throw new Error(JSON.stringify({ queueSnapshot, tasks: listFullRepoTasks(projectDir) }, null, 2));
      }
      const generatedTaskId = listFullRepoTasks(projectDir)[0]!.id;
      dispatcherRuntime.runtime.start();
      try {
        pbus.emit("runtime.idle", {
          timestamp: new Date().toISOString(),
          idleIntervalMs: 10,
        });
        await waitForLifecycle(
          () => queueAvailable.includes(generatedTaskId),
          "the generated task to become builder-eligible",
        );
      } finally {
        await dispatcherRuntime.stop();
      }

      const issue = readAutonomyIssueProjection(projectDir).issues[0]!;
      const tasks = listFullRepoTasks(projectDir);
      expect(mockedExecuteWithAgentSDK).toHaveBeenCalledTimes(1);
      expect(tasks).toEqual([expect.objectContaining({ state: "ready" })]);
      expect(issue).toMatchObject({
        status: "open",
        semanticRevision: 1,
        links: {
          taskIds: [tasks[0]!.id],
          ownerQuestionIds: [],
        },
      });

      const resolutionRunDir = join(
        projectDir,
        ".kota",
        "runs",
        "builder-resolution",
      );
      mkdirSync(resolutionRunDir, { recursive: true });
      writeFileSync(
        join(resolutionRunDir, "metadata.json"),
        JSON.stringify({
          workflow: "builder",
          status: "success",
          taskId: tasks[0]!.id,
          resolution: "root cause fixed and verified",
        }),
      );
      const clearRuntime = createRuntime([
        "autonomy-health-reviewer",
        "autonomy-health-review-publication",
        "autonomy-issue-projection-materialization",
        "repo-task-mutation",
      ]);
      clearRuntime.runtime.start();
      try {
        pbus.emit(
          autonomyHealthSignal,
          normalizeHealthSignal({
            observation: "cleared",
            source: {
              kind: "workflow",
              id: "progress-reviewer",
              workflow: "progress-reviewer",
            },
            severity: "critical",
            labels: ["runtime", "workflow-failure", "failed"],
            summary: "A successful builder verification explicitly cleared the failure.",
            evidenceRefs: [{
              kind: "run",
              ref: ".kota/runs/builder-resolution/metadata.json",
            }],
            actionability: "local-code",
            dedupeKey: issue.rootCauseKey,
            observationCount: 1,
            createdAt: "2026-08-14T03:00:00.000Z",
          }),
        );

        await waitForLifecycle(
          () => readAutonomyIssueProjection(projectDir).issues[0]?.status === "resolved",
          "the explicit clear observation",
        );
        await waitForLifecycle(
          () => attention.some((text) => text.includes("action resolved")),
          "the committed resolution attention",
        );
        await waitForLifecycle(
          () => listFullRepoTasks(projectDir)[0]?.state === "dropped",
          "the shared task mutation writer",
        );
        expect(readAutonomyIssueProjection(projectDir).issues[0]).toMatchObject({
          status: "resolved",
          semanticRevision: 1,
          links: { taskIds: [], ownerQuestionIds: [] },
        });
        expect(attention.some((text) => text.includes("action resolved"))).toBe(true);
        expect(listFullRepoTasks(projectDir)).toEqual([
          expect.objectContaining({ id: tasks[0]!.id, state: "dropped" }),
        ]);
        expect(
          JSON.parse(readFileSync(join(resolutionRunDir, "metadata.json"), "utf-8")),
        ).toMatchObject({ status: "success", taskId: tasks[0]!.id });
      } finally {
        await clearRuntime.stop();
        source.runtime.runState.close();
      }
    },
  );
});
