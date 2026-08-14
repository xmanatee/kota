import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessRunOptions,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { getPreset, SHIPPED_DEFAULT_PRESET_ID } from "#core/model/preset.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
} from "#core/workflow/trigger-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import {
  cleanupTempDirs,
  makeProjectDir,
  NOW,
} from "./progress-review/event-evidence-test-support.js";
import {
  PROGRESS_REVIEW_ARTIFACT,
  type ProgressReviewAgentEvidencePacket,
} from "./progress-review.js";
import progressReviewerWorkflow from "./workflow.js";

const TEST_PRESET = getPreset(SHIPPED_DEFAULT_PRESET_ID);

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
  getRepoWorktreeStatusAsync: vi.fn(),
}));

type TaskCountEvent = {
  runId: string;
  taskId: string;
  commitMessage: string;
};

function taskEvent(
  runId: string,
  taskId: string,
  commitMessage: string,
): TaskCountEvent {
  return { runId, taskId, commitMessage };
}

function writeTask(
  projectDir: string,
  id: string,
  options: { title: string; updatedAt: string },
): void {
  writeFileSync(
    join(projectDir, "data", "tasks", "done", `${id}.md`),
    `---
id: ${id}
title: ${options.title}
status: done
priority: p2
area: autonomy
summary: ${options.title} summary
created_at: ${options.updatedAt}
updated_at: ${options.updatedAt}
task_class: Platform
---
`,
  );
}

function writeRun(projectDir: string, id: string, startedAt: string): void {
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify(
      {
        id,
        workflow: "builder",
        status: "success",
        startedAt,
        completedAt: startedAt,
        durationMs: 1000,
      },
      null,
      2,
    ),
  );
}

function taskCountBatchPayload(
  projectDir: string,
  events: TaskCountEvent[],
): WorkflowBatchFlushPayload {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return {
    scopeId,
    projectId: scopeId,
    sourceEventName: "workflow.build.committed",
    groupingKey: `projectId=${scopeId}`,
    reason: "count",
    count: events.length,
    window: {
      firstEventAt: "2026-06-04T11:57:00.000Z",
      lastEventAt: "2026-06-04T11:59:00.000Z",
      flushedAt: NOW.toISOString(),
    },
    inputEvents: events.map((event, index) => ({
      event: "workflow.build.committed",
      schemaRef: null,
      receivedAt: `2026-06-04T11:${String(57 + index).padStart(2, "0")}:00.000Z`,
      payload: {
        scopeId,
        projectId: scopeId,
        runId: event.runId,
        taskId: event.taskId,
        commitMessage: event.commitMessage,
        costUsd: 0,
        durationMs: 1000 + index,
      },
    })),
    batch: {
      workflow: "progress-reviewer",
      triggerIndex: 3,
      maxBufferSize: 12,
      overflow: "flush-oldest",
      droppedInputCount: 0,
    },
  };
}

function registerProgressReviewHarness(run: AgentHarness["run"]): void {
  registerAgentHarness({
    name: TEST_PRESET.harness,
    description: "progress-reviewer task-count workflow test harness",
    supportsMultiTurn: false,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    run,
  });
}

function compileProgressReviewerWorkflow() {
  return validateWorkflowDefinitions([
    registerWorkflowDefinition(
      "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
      progressReviewerWorkflow,
    ),
  ], undefined, { defaultAgentHarness: TEST_PRESET.harness, preset: TEST_PRESET })[0]!;
}

function parseReviewInputFromAgentPrompt(
  options: AgentHarnessRunOptions,
): ProgressReviewAgentEvidencePacket {
  const match = options.prompt.match(
    /<step id="prepare-review-input">\n([\s\S]*?)\n<\/step>/,
  );
  if (!match) throw new Error("expected prepare-review-input in agent prompt");
  if (options.prompt.includes('<step id="collect-evidence">')) {
    throw new Error("collect-evidence must not be exposed to the agent");
  }
  return JSON.parse(match[1]!) as ProgressReviewAgentEvidencePacket;
}

function onTrackReview() {
  return {
    verdict: "on-track",
    summary: "The task-count packet returned schema-valid JSON.",
    findings: {
      crossScope: { claims: [], followUpTasks: [] },
      localScope: {
        claims: [
          {
            id: "task-count-step-returned-json",
            claim:
              "The review-evidence step cited the task-count task and event evidence.",
            evidenceIds: ["task:task-task-count-one", "event:1"],
            confidence: "high",
          },
        ],
        followUpTasks: [],
      },
    },
    ownerQuestions: [],
  };
}

describe("progress-reviewer task-count workflow", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    const { getRepoWorktreeStatus, getRepoWorktreeStatusAsync } = await import(
      "#core/util/repo-worktree.js"
    );
    const status = {
      available: true,
      dirty: false,
      trackedDirty: false,
      entries: [],
      fingerprint: "",
      summary: "clean",
      headSha: "abc1234",
    };
    vi.mocked(getRepoWorktreeStatus).mockReturnValue(status);
    vi.mocked(getRepoWorktreeStatusAsync).mockResolvedValue(status);
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupTempDirs();
  });

  it("runs review-evidence with schema-valid JSON for task-count batch payloads", async () => {
    const projectDir = makeProjectDir("progress-reviewer-runtime-task-count");
    const taskEvents: TaskCountEvent[] = [
      taskEvent("builder-task-count-001", "task-task-count-one", "Ship first"),
      taskEvent("builder-task-count-002", "task-task-count-two", "Ship second"),
      taskEvent("builder-task-count-003", "task-task-count-three", "Ship third"),
    ];
    for (const [index, event] of taskEvents.entries()) {
      const timestamp = `2026-06-04T11:${String(57 + index).padStart(2, "0")}`;
      writeTask(projectDir, event.taskId, {
        title: event.commitMessage,
        updatedAt: `${timestamp}:30.000Z`,
      });
      writeRun(projectDir, event.runId, `${timestamp}:00.000Z`);
    }

    registerProgressReviewHarness(async (options) => {
      const reviewInput = parseReviewInputFromAgentPrompt(options);
      expect(reviewInput.triggerKind).toBe("task-count");
      expect(reviewInput.batch).toEqual(
        expect.objectContaining({
          sourceEventName: "workflow.build.committed",
          count: taskEvents.length,
          inputEventCount: taskEvents.length,
        }),
      );
      expect(reviewInput.evidence.map((item) => item.id)).toEqual(
        expect.arrayContaining(["task:task-task-count-one", "event:1"]),
      );
      return {
        text: `Review complete.\n\`\`\`json\n${JSON.stringify(onTrackReview())}\n\`\`\``,
        streamedText: "",
        turns: 1,
        isError: false,
      };
    });

    const { promise } = executeWorkflowRun(
      compileProgressReviewerWorkflow(),
      {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        schemaRef: null,
        payload: taskCountBatchPayload(projectDir, taskEvents),
      },
      {
        projectDir,
        bus: new EventBus(),
        store: new WorkflowRunStore(projectDir),
        log: vi.fn(),
        runId: "runtime-task-count-packet",
      },
    );

    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps.find((step) => step.id === "review-evidence")).toEqual(
      expect.objectContaining({
        status: "success",
        output: expect.objectContaining({ verdict: "on-track" }),
      }),
    );
    const artifactPath = join(
      projectDir,
      ".kota",
      "runs",
      "runtime-task-count-packet",
      PROGRESS_REVIEW_ARTIFACT,
    );
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      reviewInput: { triggerKind: string };
      review: { findings: { localScope: { claims: Array<{ evidenceIds: string[] }> } } };
    };
    expect(artifact.reviewInput.triggerKind).toBe("task-count");
    expect(artifact.review.findings.localScope.claims[0]?.evidenceIds).toEqual([
      "task:task-task-count-one",
      "event:1",
    ]);
  });
});
