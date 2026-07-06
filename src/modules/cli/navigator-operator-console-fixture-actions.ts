import type { UiAction } from "#modules/daemon-ops/operator-ui.js";

export function consoleAction(args: {
  surfaceId: string;
  actionId: string;
  label: string;
  namespace: string;
  method: string;
  effect?: UiAction["effect"];
  confirmation?: UiAction["confirmation"];
  parameters?: UiAction["parameters"];
}): UiAction {
  const effect = args.effect ?? "read";
  return {
    surfaceId: args.surfaceId,
    actionId: args.actionId,
    scopeId: "scope-main",
    label: args.label,
    effect,
    operation: { kind: "client-namespace", namespace: args.namespace, method: args.method },
    confirmation: args.confirmation ?? { mode: "none" },
    readiness: { state: "ready" },
    parameters: args.parameters,
    result: {
      success: { message: `${args.label} completed.` },
      errors: [{ reason: "unavailable", message: "Unavailable in test." }],
    },
    permissions: [
      { kind: "effect", effect },
      { kind: "capability-scope", scope: effect === "read" ? "read" : "control" },
    ],
  };
}

const confirmPause: UiAction["confirmation"] = {
  mode: "required",
  title: "Pause workflow dispatch",
  detail: "No new workflow runs will be dispatched until resumed.",
  confirmLabel: "Pause dispatch",
  risk: "medium",
};

const confirmAbort: UiAction["confirmation"] = {
  mode: "required",
  title: "Abort workflow run",
  detail: "This asks a workflow run to stop.",
  confirmLabel: "Abort run",
  risk: "high",
};

function runIdParameters(label: string): UiAction["parameters"] {
  return {
    fields: [{ id: "runId", label, input: "text", required: true }],
    schema: {
      type: "object",
      required: ["runId"],
      properties: { runId: { type: "string" } },
      additionalProperties: false,
    },
  };
}

export function operatorConsoleRunActions(): UiAction[] {
  return [
    consoleAction({ surfaceId: "runs", actionId: "workflow.status", label: "Refresh workflow status", namespace: "workflow", method: "status" }),
    consoleAction({ surfaceId: "runs", actionId: "workflow.pause", label: "Pause dispatch", namespace: "workflow", method: "pause", effect: "write", confirmation: confirmPause }),
    consoleAction({ surfaceId: "runs", actionId: "workflow.resume", label: "Resume dispatch", namespace: "workflow", method: "resume", effect: "write" }),
    consoleAction({
      surfaceId: "runs",
      actionId: "run.abort",
      label: "Abort one run",
      namespace: "workflow",
      method: "abortRun",
      effect: "write",
      confirmation: confirmAbort,
      parameters: runIdParameters("Run id"),
    }),
    consoleAction({
      surfaceId: "runs",
      actionId: "run.cancel-queued",
      label: "Cancel queued run",
      namespace: "workflow",
      method: "cancelRun",
      effect: "write",
      confirmation: {
        mode: "required",
        title: "Cancel queued workflow run",
        detail: "This removes one queued workflow run before it starts.",
        confirmLabel: "Cancel queued run",
        risk: "medium",
      },
      parameters: runIdParameters("Queued run id"),
    }),
    consoleAction({
      surfaceId: "runs",
      actionId: "run.retry",
      label: "Retry failed run",
      namespace: "workflow",
      method: "retryRun",
      effect: "write",
      confirmation: {
        mode: "required",
        title: "Retry failed workflow run",
        detail: "This queues a retry for one failed run.",
        confirmLabel: "Retry run",
        risk: "medium",
      },
      parameters: runIdParameters("Failed run id"),
    }),
    consoleAction({
      surfaceId: "runs",
      actionId: "run.replay",
      label: "Replay run",
      namespace: "workflow",
      method: "replayRun",
      effect: "write",
      confirmation: {
        mode: "required",
        title: "Replay workflow run",
        detail: "This queues a fresh run with the original trigger payload.",
        confirmLabel: "Replay run",
        risk: "medium",
      },
      parameters: runIdParameters("Completed run id"),
    }),
    consoleAction({
      surfaceId: "runs",
      actionId: "run.resume",
      label: "Resume run from step",
      namespace: "workflow",
      method: "resumeRun",
      effect: "write",
      confirmation: {
        mode: "required",
        title: "Resume workflow run",
        detail: "This queues a fresh run from the requested step.",
        confirmLabel: "Resume run",
        risk: "medium",
      },
      parameters: {
        fields: [
          { id: "runId", label: "Failed run id", input: "text", required: true },
          { id: "fromStep", label: "Resume from step", input: "text", required: true },
        ],
        schema: {
          type: "object",
          required: ["runId", "fromStep"],
          properties: { runId: { type: "string" }, fromStep: { type: "string" } },
          additionalProperties: false,
        },
      },
    }),
  ];
}
