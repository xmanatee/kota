/**
 * Restart-time replay for pausable await-event step suspensions.
 *
 * The runtime invokes `installAwaitResumers` once at startup (after
 * `recoverInterruptedRuns` has marked stale runs interrupted). For every
 * persisted suspension under `.kota/runs/<run-id>/awaits/<step-id>.json`
 * this:
 *
 * - Skips suspensions whose owning run is no longer interrupted (live
 *   completion already consumed the suspension; files are stale).
 *   Stale suspensions are deleted so they don't accumulate forever.
 * - Resumes immediately when the suspension has a sibling `delivered.json`
 *   produced either by a live match the daemon could not record before
 *   crashing, or by an external producer that captured the answer during
 *   the daemon-down gap.
 *   The captured payload is injected into the resume run trigger via
 *   `awaitEventPayloads` (`step-executor-await-event.ts`).
 * - Otherwise registers a one-shot bus listener that, on first match by
 *   `matchField:matchValue`, queues a resume run with the matched payload.
 *   When `awaitTimeoutMs` is set, the remaining deadline is honored: if
 *   already past, a timeout resume is queued immediately; if still in the
 *   future, a `setTimeout` races the bus listener and the first to fire
 *   tears down the other.
 *
 * Suspensions referencing missing workflows or missing steps fail loudly:
 * the file is deleted and a clear log line is emitted so operators can see
 * the lost recovery candidate.
 */

import type { EventBus } from "#core/events/event-bus.js";
import {
  type AwaitDelivery,
  type AwaitSuspension,
  clearAwaitFiles,
  scanSuspensions,
} from "./awaits-store.js";
import type { WorkflowRunStore } from "./run-store.js";
import { formatRunId } from "./run-store-helpers.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import { AWAIT_EVENT_PAYLOADS_KEY } from "./steps/step-executor-await-event.js";
import type {
  WorkflowAwaitEventStep,
  WorkflowDefinition,
  WorkflowStep,
} from "./types.js";

export type InstallAwaitResumersDeps = {
  bus: EventBus;
  store: WorkflowRunStore;
  definitions: readonly WorkflowDefinition[];
  log: (message: string) => void;
  /**
   * Append a queued resume run to the runtime's workflow queue. The runtime
   * implementation also persists the queue to disk; tests pass a thin
   * implementation that updates the store directly. The callee should dedup
   * by `runId` so a buffered delivery and a live bus match cannot both
   * queue the same resume.
   */
  appendResumeRun: (queued: WorkflowQueuedRun) => void;
  /** Called after the resume run is added to the pending queue. */
  onScheduled: () => void;
  /** Disposers returned for shutdown cleanup (subscribers and timers). */
  disposers?: Array<() => void>;
};

function findAwaitStep(
  definition: WorkflowDefinition,
  stepId: string,
): WorkflowAwaitEventStep | null {
  function find(steps: readonly WorkflowStep[]): WorkflowAwaitEventStep | null {
    for (const step of steps) {
      if (step.type === "await-event" && step.id === stepId) return step;
      if (step.type === "parallel" || step.type === "foreach") {
        const inner = find(step.steps);
        if (inner) return inner;
      } else if (step.type === "branch") {
        const inner = find([...step.ifTrue, ...step.ifFalse]);
        if (inner) return inner;
      }
    }
    return null;
  }
  return find(definition.steps);
}

function awaitEventPayloadsForResume(
  stepId: string,
  delivery: AwaitDelivery | { kind: "event"; event: string; payload: Record<string, unknown> },
  matchField: string,
  matchValue: string | number,
): Record<string, unknown> {
  const eventOutput = delivery.kind === "event"
    ? {
        kind: "event" as const,
        event: delivery.event,
        matchField,
        matchValue,
        payload: delivery.payload,
      }
    : {
        kind: "timeout" as const,
        event: delivery.event,
        matchField,
        matchValue,
        awaitTimeoutMs:
          (delivery as Extract<AwaitDelivery, { kind: "timeout" }>).awaitTimeoutMs,
      };
  return { [stepId]: eventOutput };
}

function queueResumeRun(
  deps: InstallAwaitResumersDeps,
  suspension: AwaitSuspension,
  awaitEventPayloads: Record<string, unknown>,
): void {
  const newRunId = formatRunId(suspension.workflowName);
  const queued: WorkflowQueuedRun = {
    runId: newRunId,
    workflowName: suspension.workflowName,
    trigger: {
      event: "resume",
      payload: {
        _runId: newRunId,
        resumedFromRunId: suspension.runId,
        resumeFromStep: suspension.stepId,
        [AWAIT_EVENT_PAYLOADS_KEY]: awaitEventPayloads,
      },
    },
    enqueuedAtMs: Date.now(),
    notBeforeMs: Date.now(),
  };
  deps.appendResumeRun(queued);
  deps.onScheduled();
}

function isOriginRunResolved(
  store: WorkflowRunStore,
  runId: string,
): "interrupted" | "missing" | "live" {
  const run = store.getRun(runId);
  if (!run) return "missing";
  if (run.status === "interrupted") return "interrupted";
  // success / failed / completed-with-warnings / running — already past the await
  // or still actively waiting. Either way, restart should not double-resume.
  return "live";
}

export function installAwaitResumers(deps: InstallAwaitResumersDeps): void {
  const scanned = scanSuspensions(deps.store.runsDir);
  for (const { suspension, runDir, delivery } of scanned) {
    const status = isOriginRunResolved(deps.store, suspension.runId);
    if (status !== "interrupted") {
      // Stale suspension — its run is no longer waiting. Clean up the files.
      clearAwaitFiles(runDir, suspension.stepId);
      continue;
    }
    const definition = deps.definitions.find(
      (d) => d.name === suspension.workflowName,
    );
    if (!definition) {
      deps.log(
        `Cannot resume await on "${suspension.workflowName}" run ${suspension.runId} step "${suspension.stepId}": ` +
          `workflow no longer registered. Removing suspension.`,
      );
      clearAwaitFiles(runDir, suspension.stepId);
      continue;
    }
    const awaitStep = findAwaitStep(definition, suspension.stepId);
    if (!awaitStep) {
      deps.log(
        `Cannot resume await on "${suspension.workflowName}" run ${suspension.runId} step "${suspension.stepId}": ` +
          `step missing from workflow definition. Removing suspension.`,
      );
      clearAwaitFiles(runDir, suspension.stepId);
      continue;
    }

    if (delivery) {
      const payloads = awaitEventPayloadsForResume(
        suspension.stepId,
        delivery,
        suspension.matchField,
        suspension.matchValue,
      );
      queueResumeRun(deps, suspension, payloads);
      // Files removed by the resume run when the step short-circuits.
      continue;
    }

    if (
      suspension.deadlineAtMs !== undefined &&
      Date.now() >= suspension.deadlineAtMs
    ) {
      const payloads = awaitEventPayloadsForResume(
        suspension.stepId,
        {
          kind: "timeout",
          deliveredAt: new Date().toISOString(),
          event: suspension.event,
          awaitTimeoutMs: suspension.awaitTimeoutMs!,
        },
        suspension.matchField,
        suspension.matchValue,
      );
      queueResumeRun(deps, suspension, payloads);
      continue;
    }

    // Live wait: subscribe to bus and (optionally) schedule a timeout race.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | null = null;
    let fired = false;
    const finish = (
      payloads: Record<string, unknown>,
    ): void => {
      if (fired) return;
      fired = true;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      queueResumeRun(deps, suspension, payloads);
    };

    unsubscribe = deps.bus.on(
      suspension.event,
      (payload: Record<string, unknown>) => {
        if (fired) return;
        if (payload[suspension.matchField] !== suspension.matchValue) return;
        finish(
          awaitEventPayloadsForResume(
            suspension.stepId,
            { kind: "event", deliveredAt: new Date().toISOString(), event: suspension.event, payload },
            suspension.matchField,
            suspension.matchValue,
          ),
        );
      },
    );

    if (suspension.deadlineAtMs !== undefined) {
      const remaining = Math.max(0, suspension.deadlineAtMs - Date.now());
      timer = setTimeout(() => {
        finish(
          awaitEventPayloadsForResume(
            suspension.stepId,
            {
              kind: "timeout",
              deliveredAt: new Date().toISOString(),
              event: suspension.event,
              awaitTimeoutMs: suspension.awaitTimeoutMs!,
            },
            suspension.matchField,
            suspension.matchValue,
          ),
        );
      }, remaining);
      timer.unref?.();
    }

    deps.disposers?.push(() => {
      if (fired) return;
      if (timer) clearTimeout(timer);
      if (unsubscribe) unsubscribe();
    });
  }
}
