import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeadLetterItem } from "#core/daemon/dead-letter-queue.js";
import { deadLetterChangedEventPayload } from "#core/daemon/dead-letter-queue-events.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { executeWithAgentSDK } from "#modules/claude-agent-harness/executor.js";
import {
  getRepoTaskQueueSnapshot,
  listFullRepoTasks,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  seedIssueDrivenLoopFixture,
  waitUntil,
} from "./autonomous-loop.integration-test-helpers.js";
import { autonomyIssueDecisionRequested } from "./autonomy-issue-events.js";
import { readAutonomyIssueProjection } from "./autonomy-issue-projection.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import { makeAutonomyIssueSourceContext } from "./autonomy-issue-sources.test-helpers.js";
import { createTestWorkflowRuntime } from "./autonomy-runtime.test-helpers.js";
import {
  asOpenDeadLetter,
  autonomyWorkflowInputs,
  CAPTURE_DIR,
  type DeadLetterCapture,
  readJson,
  writeDeadLetterSnapshot,
} from "./production-routing-replay.integration-test-helpers.js";

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

describe("production dead-letter routing replay", () => {
  const tempDirs: string[] = [];
  let savedPreset: string | undefined;

  beforeEach(() => {
    savedPreset = process.env[PRESET_ENV_VAR];
    process.env[PRESET_ENV_VAR] = "claude";
    mockedExecuteWithAgentSDK.mockReset();
  });

  afterEach(() => {
    if (savedPreset === undefined) delete process.env[PRESET_ENV_VAR];
    else process.env[PRESET_ENV_VAR] = savedPreset;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "routes the four captured passive-Codex dead letters through one issue, decision, task, and clear",
    { timeout: 90_000 },
    async () => {
      const capture = readJson<DeadLetterCapture>(
        join(CAPTURE_DIR, "progress-reviewer-dead-letters.json"),
      );
      expect(capture.records).toHaveLength(4);
      expect(capture.verification).toMatchObject({
        recordCount: 4,
        allTerminal: true,
        repairCommit: "532ab1ae",
      });
      expect(capture.verification.successfulProductionRuns).toHaveLength(2);

      const projectDir = mkdtempSync(join(tmpdir(), "kota-production-dlq-replay-"));
      tempDirs.push(projectDir);
      seedIssueDrivenLoopFixture(projectDir);
      const scopeId = capture.records[0]!.scopeId;
      expect(new Set(capture.records.map((record) => record.scopeId))).toEqual(
        new Set([scopeId]),
      );

      const disposition = {
        action: "create-task",
        rationale: "The passive Codex capability failure needs one builder repair.",
        taskTitle: "Repair passive Codex workflow compatibility",
        taskSummary: "Reject the incompatible native harness contract before dispatch.",
        taskPriority: "p1",
        taskArea: "autonomy",
        taskClass: "Product",
        taskHowWeWillKnow:
          "The captured production incident reaches one typed clear without another AI review.",
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
      const pbus = new ProjectScopedEventBus(bus, scopeId);
      const source = makeAutonomyIssueSourceContext(projectDir, bus, scopeId);
      subscribeAutonomyIssueSources(source.ctx);
      const completed: Array<{ workflow: string; status: string }> = [];
      const attention: string[] = [];
      const decisionRequests: Array<{
        issueKey: string;
        semanticRevision: number;
        transition: string;
      }> = [];
      bus.on("workflow.completed", (payload) =>
        completed.push({ workflow: payload.workflow, status: payload.status })
      );
      bus.on("workflow.attention.digest", (payload) => attention.push(payload.text));
      bus.on(autonomyIssueDecisionRequested, (payload) => {
        decisionRequests.push({
          issueKey: payload.issueKey,
          semanticRevision: payload.semanticRevision,
          transition: payload.transition,
        });
      });

      const rawDefinitions = await autonomyWorkflowInputs();
      const runtimeFixture = createTestWorkflowRuntime({
        config: {
          defaultAgentHarness: "claude-agent-sdk",
          defaultPreset: "claude",
        },
        bus,
        pbus,
        projectDir,
        projectId: scopeId,
        runStore: source.runtime.runStore,
        deadLetterQueue: source.runtime.deadLetterQueue,
        idleIntervalMs: 10_000,
        workflows: rawDefinitions
          .filter(
            (workflow) =>
              workflow.name === "autonomy-health-reviewer" ||
              workflow.name === "autonomy-health-review-publication" ||
              workflow.name === "autonomy-issue-projection-materialization" ||
              workflow.name === "improver" ||
              workflow.name === "improver-disposition-publication",
          )
          .map((workflow) => ({
            ...workflow,
            triggers: workflow.triggers.filter((trigger) => trigger.schedule === undefined),
          })),
      });

      const { runtime } = runtimeFixture;
      const recordsById = new Map(capture.records.map((record) => [record.id, record]));
      const capturedIssue = () =>
        readAutonomyIssueProjection(projectDir).issues.find(
          (issue) => issue.source.kind === "workflow" && issue.source.id === "progress-reviewer",
        );
      const openItems: DeadLetterItem[] = [];
      const openingOrder = [...capture.dispositions].sort((left, right) =>
        left.before.at.localeCompare(right.before.at)
      );
      runtime.start();
      try {
        for (const [index, lifecycle] of openingOrder.entries()) {
          const record = recordsById.get(lifecycle.id);
          if (!record) throw new Error(`missing captured dead letter ${lifecycle.id}`);
          const open = asOpenDeadLetter(record, lifecycle.before.at);
          openItems.push(open);
          writeDeadLetterSnapshot(projectDir, openItems);
          pbus.emit("workflow.dead-letter.changed", deadLetterChangedEventPayload(open));
          await waitForLifecycle(
            () =>
              capturedIssue()?.history.length === index + 1,
            `production dead-letter observation ${index + 1}`,
          );
          if (index === 0) {
            await waitForLifecycle(
              () => listFullRepoTasks(projectDir).some((task) => task.state === "ready"),
              "the single generated repair task",
            );
          }
        }

        const openIssue = capturedIssue()!;
        const readyTasks = listFullRepoTasks(projectDir).filter((task) =>
          openIssue.links.taskIds.includes(task.id)
        );
        expect(decisionRequests.filter((request) => request.issueKey === openIssue.issueKey))
          .toEqual([{
          issueKey: openIssue.issueKey,
          semanticRevision: 1,
          transition: "opened",
          }]);
        expect(openIssue).toMatchObject({
          status: "open",
          semanticRevision: 1,
          disposition: { kind: "task" },
          links: {
            deadLetterIds: capture.records.map((record) => record.id).sort(),
            ownerQuestionIds: [],
          },
        });
        expect(openIssue.history.map((entry) => entry.transition)).toEqual([
          "opened",
          "repeated",
          "repeated",
          "repeated",
        ]);
        expect(readyTasks).toEqual([expect.objectContaining({ state: "ready" })]);
        expect(openIssue.links.taskIds).toEqual([readyTasks[0]!.id]);
        expect(getRepoTaskQueueSnapshot(projectDir).hasDispatchableWork).toBe(true);
        expect(attention.some((text) => text.includes("action decision-requested"))).toBe(
          true,
        );

        const terminalById = new Map(capture.records.map((record) => [record.id, record]));
        const closingOrder = [...capture.dispositions].sort((left, right) =>
          left.after.at.localeCompare(right.after.at)
        );
        for (const lifecycle of closingOrder) {
          const terminal = terminalById.get(lifecycle.id);
          if (!terminal) throw new Error(`missing terminal dead letter ${lifecycle.id}`);
          const index = openItems.findIndex((item) => item.id === terminal.id);
          openItems[index] = terminal;
          writeDeadLetterSnapshot(projectDir, openItems);
          pbus.emit(
            "workflow.dead-letter.changed",
            deadLetterChangedEventPayload(terminal),
          );
        }

        await waitForLifecycle(
          () => capturedIssue()?.status === "resolved",
          "the terminal production dead-letter clear",
        );
        await waitForLifecycle(
          () => attention.some((text) => text.includes("action resolved")),
          "resolution attention",
        );

        const resolvedIssue = capturedIssue()!;
        expect(resolvedIssue).toMatchObject({
          status: "resolved",
          semanticRevision: 1,
          disposition: { kind: "cleared" },
          links: {
            taskIds: [],
            ownerQuestionIds: [],
            deadLetterIds: capture.records.map((record) => record.id).sort(),
          },
        });
        expect(resolvedIssue.history.map((entry) => entry.transition)).toEqual([
          "opened",
          "repeated",
          "repeated",
          "repeated",
          "cleared",
        ]);
        expect(listFullRepoTasks(projectDir)).toContainEqual(
          expect.objectContaining({ id: readyTasks[0]!.id, state: "dropped" }),
        );
        expect(attention.some((text) => text.includes("action resolved"))).toBe(true);
        expect(completed.filter((run) => run.workflow === "improver")).toHaveLength(1);
        expect(
          completed.some((run) => run.workflow === "autonomy-health-reviewer"),
        ).toBe(true);
        expect(completed.every((run) => run.status === "success")).toBe(true);
      } finally {
        await runtimeFixture.stop();
        source.runtime.runState.close();
      }
    },
  );
});
