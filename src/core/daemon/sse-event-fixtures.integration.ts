/**
 * Shared typed test fixtures for `DaemonSseEvent` consumers.
 *
 * Each helper returns a fully-formed variant payload. Tests pass overrides
 * for fields they actually assert on; the rest stay at deterministic
 * defaults so the discriminated union narrows cleanly without test code
 * sprinkling internal type assertions.
 */
import type { BusEvents } from "#core/events/event-bus-types.js";
import type { DaemonSseEvent } from "./daemon-control-types.js";

const DEFAULT_RUN_ID = "test-run";
const DEFAULT_TIMESTAMP = "2026-01-01T00:00:00.000Z";
const DEFAULT_PROJECT_ID = "test-project";

export function makeWorkflowStartedEvent(
  overrides: Partial<BusEvents["workflow.started"]> = {},
): DaemonSseEvent {
  return {
    type: "workflow.started",
    payload: {
      projectId: DEFAULT_PROJECT_ID,
      workflow: "builder",
      runId: DEFAULT_RUN_ID,
      triggerEvent: "test",
      definitionPath: "",
      runDir: "",
      startedAt: DEFAULT_TIMESTAMP,
      ...overrides,
    },
  };
}

export function makeWorkflowCompletedEvent(
  overrides: Partial<BusEvents["workflow.completed"]> = {},
): DaemonSseEvent {
  return {
    type: "workflow.completed",
    payload: {
      projectId: DEFAULT_PROJECT_ID,
      workflow: "builder",
      runId: DEFAULT_RUN_ID,
      status: "success",
      triggerEvent: "test",
      durationMs: 0,
      definitionPath: "",
      runDir: "",
      tags: [],
      ...overrides,
    },
  };
}

export function makeWorkflowStepCompletedEvent(
  overrides: Partial<BusEvents["workflow.step.completed"]> = {},
): DaemonSseEvent {
  return {
    type: "workflow.step.completed",
    payload: {
      projectId: DEFAULT_PROJECT_ID,
      workflow: "builder",
      runId: DEFAULT_RUN_ID,
      stepId: "step-1",
      stepType: "agent",
      status: "success",
      durationMs: 0,
      runDir: "",
      definitionPath: "",
      ...overrides,
    },
  };
}

export function makeTaskChangedEvent(
  overrides: Partial<BusEvents["task.changed"]> = {},
): DaemonSseEvent {
  return {
    type: "task.changed",
    payload: {
      projectId: DEFAULT_PROJECT_ID,
      counts: { pending: 0, in_progress: 0, done: 0 },
      ...overrides,
    },
  };
}
