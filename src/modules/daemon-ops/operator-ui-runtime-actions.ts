import {
  action,
  resultSpec,
} from "./operator-ui-builder-common.js";
import {
  runAbortParameters,
  runCancelParameters,
  runReplayParameters,
  runResumeParameters,
  runRetryParameters,
} from "./operator-ui-runtime-helpers.js";
import type { UiAction } from "./operator-ui-types.js";

export type RuntimeRunActions = {
  abortOneRun: UiAction;
  cancelQueuedRun: UiAction;
  retryRun: UiAction;
  replayRun: UiAction;
  resumeRun: UiAction;
  all: UiAction[];
};

export function runtimeRunActions(scopeId: string): RuntimeRunActions {
  const abortOneRun = action({
    surfaceId: "runs",
    actionId: "run.abort",
    scopeId,
    label: "Abort one run",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "workflow", method: "abortRun" },
    parameters: runAbortParameters(),
    confirmation: {
      mode: "required",
      title: "Abort workflow run",
      detail: "This asks one active workflow run to stop.",
      confirmLabel: "Abort run",
      risk: "high",
    },
    result: resultSpec("Workflow run aborted."),
  });
  const cancelQueuedRun = action({
    surfaceId: "runs",
    actionId: "run.cancel-queued",
    scopeId,
    label: "Cancel queued run",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "workflow", method: "cancelRun" },
    parameters: runCancelParameters(),
    confirmation: {
      mode: "required",
      title: "Cancel queued workflow run",
      detail: "This removes one queued workflow run before it starts.",
      confirmLabel: "Cancel queued run",
      risk: "medium",
    },
    result: resultSpec("Queued workflow run cancelled."),
  });
  const retryRun = action({
    surfaceId: "runs",
    actionId: "run.retry",
    scopeId,
    label: "Retry failed run",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "workflow", method: "retryRun" },
    parameters: runRetryParameters(),
    confirmation: {
      mode: "required",
      title: "Retry failed workflow run",
      detail: "This queues a retry that reuses completed step output and resumes at the first failed step.",
      confirmLabel: "Retry run",
      risk: "medium",
    },
    result: resultSpec("Workflow retry queued."),
  });
  const replayRun = action({
    surfaceId: "runs",
    actionId: "run.replay",
    scopeId,
    label: "Replay run",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "workflow", method: "replayRun" },
    parameters: runReplayParameters(),
    confirmation: {
      mode: "required",
      title: "Replay workflow run",
      detail: "This queues a fresh run with the original trigger payload.",
      confirmLabel: "Replay run",
      risk: "medium",
    },
    result: resultSpec("Workflow replay queued."),
  });
  const resumeRun = action({
    surfaceId: "runs",
    actionId: "run.resume",
    scopeId,
    label: "Resume run from step",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "workflow", method: "resumeRun" },
    parameters: runResumeParameters(),
    confirmation: {
      mode: "required",
      title: "Resume workflow run",
      detail: "This queues a fresh run that reuses prior successful steps before the selected step.",
      confirmLabel: "Resume run",
      risk: "medium",
    },
    result: resultSpec("Workflow resume queued."),
  });

  return {
    abortOneRun,
    cancelQueuedRun,
    retryRun,
    replayRun,
    resumeRun,
    all: [abortOneRun, cancelQueuedRun, retryRun, replayRun, resumeRun],
  };
}
