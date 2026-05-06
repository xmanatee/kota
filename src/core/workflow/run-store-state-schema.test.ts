import { describe, expect, it } from "vitest";
import { JsonFileError } from "#core/util/json-file.js";
import {
  assertWorkflowRunMetadata,
  assertWorkflowRuntimeState,
  isPlainObject,
} from "./run-store-state-schema.js";

const path = "/state.json";

const validTrigger = { event: "runtime.idle", payload: {} };

const validState = {
  completedRuns: 0,
  pendingRuns: [],
  workflows: {},
};

// ---------------------------------------------------------------------------
// isPlainObject
// ---------------------------------------------------------------------------

describe("isPlainObject", () => {
  it("returns true for plain objects", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it("returns false for non-objects", () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("string")).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(() => {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertWorkflowRuntimeState
// ---------------------------------------------------------------------------

describe("assertWorkflowRuntimeState", () => {
  it("accepts minimal valid state", () => {
    expect(() => assertWorkflowRuntimeState(path, validState)).not.toThrow();
  });

  it("accepts state with workflow entries including all optional fields", () => {
    const state = {
      ...validState,
      completedRuns: 5,
      workflows: {
        builder: {
          lastStarted: { runId: "run-1", startedAt: "2026-01-01" },
          lastCompletion: {
            runId: "run-1",
            startedAt: "2026-01-01",
            completedAt: "2026-01-01",
            status: "success",
          },
        },
      },
    };
    expect(() => assertWorkflowRuntimeState(path, state)).not.toThrow();
  });

  it("accepts active agent backoff state", () => {
    const state = {
      ...validState,
      agentBackoff: {
        kind: "rate_limit",
        failureCount: 2,
        until: "2026-01-01T02:00:00.000Z",
        updatedAt: "2026-01-01T01:30:00.000Z",
        reason: "Agent step failed: You've hit your limit",
      },
    };
    expect(() => assertWorkflowRuntimeState(path, state)).not.toThrow();
  });

  it("accepts recovery state", () => {
    const state = {
      ...validState,
      recovery: {
        sourceRunId: "run-1",
        sourceWorkflow: "improver",
        worktreeFingerprint: "M README.md",
        worktreeSummary: "M README.md",
        attempts: 1,
        retryAttemptedBy: [],
        updatedAt: "2026-01-01T01:30:00.000Z",
      },
    };
    expect(() => assertWorkflowRuntimeState(path, state)).not.toThrow();
  });

  it("accepts pending runs with valid queued run entries", () => {
    const state = {
      ...validState,
      pendingRuns: [
        {
          workflowName: "builder",
          trigger: validTrigger,
          enqueuedAtMs: 1000,
          notBeforeMs: 1000,
        },
      ],
    };
    expect(() => assertWorkflowRuntimeState(path, state)).not.toThrow();
  });

  it("accepts pending workflow completion runs with typed completion payloads", () => {
    const state = {
      ...validState,
      pendingRuns: [
        {
          workflowName: "attention-digest",
          trigger: {
            event: "workflow.completed",
            payload: {
              workflow: "explorer",
              runId: "run-1",
              status: "interrupted",
              triggerEvent: "autonomy.queue.thin",
              durationMs: 1000,
              definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
              runDir: ".kota/runs/run-1",
              tags: ["monitored"],
              autonomyMode: "autonomous",
            },
          },
          enqueuedAtMs: 1000,
          notBeforeMs: 1000,
        },
      ],
    };
    expect(() => assertWorkflowRuntimeState(path, state)).not.toThrow();
  });

  it("throws when pending workflow completion tags are not an array", () => {
    const state = {
      ...validState,
      pendingRuns: [
        {
          workflowName: "attention-digest",
          trigger: {
            event: "workflow.completed",
            payload: {
              workflow: "explorer",
              runId: "run-1",
              status: "interrupted",
              triggerEvent: "autonomy.queue.thin",
              durationMs: 1000,
              definitionPath: "src/modules/autonomy/workflows/explorer/workflow.ts",
              runDir: ".kota/runs/run-1",
              tags: "[Circular]",
            },
          },
          enqueuedAtMs: 1000,
          notBeforeMs: 1000,
        },
      ],
    };
    expect(() => assertWorkflowRuntimeState(path, state)).toThrow(JsonFileError);
  });

  it("throws when value is not a plain object", () => {
    expect(() => assertWorkflowRuntimeState(path, null)).toThrow(JsonFileError);
    expect(() => assertWorkflowRuntimeState(path, [])).toThrow(JsonFileError);
    expect(() => assertWorkflowRuntimeState(path, "string")).toThrow(JsonFileError);
  });

  it("throws when completedRuns is missing", () => {
    const { completedRuns: _, ...state } = validState;
    expect(() => assertWorkflowRuntimeState(path, state)).toThrow(JsonFileError);
  });

  it("throws when completedRuns is not an integer", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, { ...validState, completedRuns: 1.5 }),
    ).toThrow(JsonFileError);
  });

  it("throws when completedRuns is negative", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, { ...validState, completedRuns: -1 }),
    ).toThrow(JsonFileError);
  });

  it("throws when pendingRuns is not an array", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, { ...validState, pendingRuns: "bad" }),
    ).toThrow(JsonFileError);
  });

  it("throws when pendingRuns contains invalid entry", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        pendingRuns: [{ workflowName: "x" }],
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when workflows is not a plain object", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, { ...validState, workflows: [] }),
    ).toThrow(JsonFileError);
  });

  it("throws when a workflow entry is not a plain object", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        workflows: { builder: "bad" },
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when lastStarted runId is blank", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        workflows: { builder: { lastStarted: { runId: "  ", startedAt: "2026-01-01" } } },
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when lastStarted startedAt is missing", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        workflows: { builder: { lastStarted: { runId: "run-1" } } },
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when lastCompletion is missing completedAt", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        workflows: {
          builder: {
            lastCompletion: {
              runId: "run-1",
              startedAt: "2026-01-01",
              status: "success",
            },
          },
        },
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when lastCompletion.status is invalid", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        workflows: {
          builder: {
            lastCompletion: {
              runId: "run-1",
              startedAt: "2026-01-01",
              completedAt: "2026-01-01",
              status: "unknown",
            },
          },
        },
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when agentBackoff is malformed", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        agentBackoff: {
          kind: "rate_limit",
          failureCount: 0,
          until: "2026-01-01T02:00:00.000Z",
          updatedAt: "2026-01-01T01:30:00.000Z",
          reason: "",
        },
      }),
    ).toThrow(JsonFileError);
  });

  it("throws when recovery is malformed", () => {
    expect(() =>
      assertWorkflowRuntimeState(path, {
        ...validState,
        recovery: {
          sourceRunId: "run-1",
          sourceWorkflow: "improver",
          worktreeFingerprint: "M README.md",
          worktreeSummary: "M README.md",
          attempts: -1,
          updatedAt: "2026-01-01T01:30:00.000Z",
        },
      }),
    ).toThrow(JsonFileError);
  });

});

// ---------------------------------------------------------------------------
// assertWorkflowRunMetadata
// ---------------------------------------------------------------------------

const validMetadata = {
  id: "run-1",
  workflow: "builder",
  definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  trigger: validTrigger,
  startedAt: "2026-01-01T00:00:00.000Z",
  status: "running",
  runDir: ".kota/runs/run-1",
  steps: [],
};

describe("assertWorkflowRunMetadata", () => {
  it("accepts valid running metadata", () => {
    expect(() => assertWorkflowRunMetadata(path, validMetadata)).not.toThrow();
  });

  it("accepts completed metadata with terminal statuses", () => {
    for (const status of [
      "success",
      "failed",
      "interrupted",
      "completed-with-warnings",
    ] as const) {
      expect(() =>
        assertWorkflowRunMetadata(path, { ...validMetadata, status }),
      ).not.toThrow();
    }
  });

  it("throws when value is not a plain object", () => {
    expect(() => assertWorkflowRunMetadata(path, null)).toThrow(JsonFileError);
    expect(() => assertWorkflowRunMetadata(path, "str")).toThrow(JsonFileError);
  });

  it("throws when id is missing", () => {
    const { id: _, ...rest } = validMetadata;
    expect(() => assertWorkflowRunMetadata(path, rest)).toThrow(JsonFileError);
  });

  it("throws when workflow is missing", () => {
    const { workflow: _, ...rest } = validMetadata;
    expect(() => assertWorkflowRunMetadata(path, rest)).toThrow(JsonFileError);
  });

  it("throws when definitionPath is missing", () => {
    const { definitionPath: _, ...rest } = validMetadata;
    expect(() => assertWorkflowRunMetadata(path, rest)).toThrow(JsonFileError);
  });

  it("throws when trigger is invalid", () => {
    expect(() =>
      assertWorkflowRunMetadata(path, { ...validMetadata, trigger: { event: "x" } }),
    ).toThrow(JsonFileError);
  });

  it("throws when startedAt is missing", () => {
    const { startedAt: _, ...rest } = validMetadata;
    expect(() => assertWorkflowRunMetadata(path, rest)).toThrow(JsonFileError);
  });

  it("throws when runDir is missing", () => {
    const { runDir: _, ...rest } = validMetadata;
    expect(() => assertWorkflowRunMetadata(path, rest)).toThrow(JsonFileError);
  });

  it("throws when steps is not an array", () => {
    expect(() =>
      assertWorkflowRunMetadata(path, { ...validMetadata, steps: {} }),
    ).toThrow(JsonFileError);
  });

  it("throws when status is invalid", () => {
    expect(() =>
      assertWorkflowRunMetadata(path, { ...validMetadata, status: "pending" }),
    ).toThrow(JsonFileError);
  });

  it("requires skipped steps to carry a valid skipReason", () => {
    const skipped = {
      id: "skip",
      type: "code",
      status: "skipped",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 0,
    };

    expect(() =>
      assertWorkflowRunMetadata(path, { ...validMetadata, steps: [skipped] }),
    ).toThrow(JsonFileError);
    expect(() =>
      assertWorkflowRunMetadata(path, {
        ...validMetadata,
        steps: [{ ...skipped, skipReason: { kind: "when-predicate" } }],
      }),
    ).not.toThrow();
  });

  it("rejects skipReason on non-skipped steps", () => {
    expect(() =>
      assertWorkflowRunMetadata(path, {
        ...validMetadata,
        steps: [
          {
            id: "ok",
            type: "code",
            status: "success",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:00.001Z",
            durationMs: 1,
            skipReason: { kind: "when-predicate" },
          },
        ],
      }),
    ).toThrow(JsonFileError);
  });
});
