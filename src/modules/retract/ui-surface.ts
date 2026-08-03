import type { UiActionParameterSpec, UiSurface } from "#core/daemon/ui-surface.js";
import { action, resultSpec } from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";

function retractParameters(): UiActionParameterSpec {
  const target = {
    type: "string" as const,
    enum: ["memory", "knowledge", "tasks", "inbox"],
    default: "memory",
  };
  return {
    fields: [
      {
        id: "target",
        label: "Store",
        input: "select",
        required: true,
        options: [
          { label: "Memory", value: "memory" },
          { label: "Knowledge", value: "knowledge" },
          { label: "Tasks", value: "tasks" },
          { label: "Inbox", value: "inbox" },
        ],
        schema: target,
      },
      {
        id: "identifier",
        label: "Record id, slug, or inbox path",
        input: "text",
        required: true,
        schema: { type: "string" },
      },
    ],
    schema: {
      type: "object",
      required: ["target", "identifier"],
      properties: { target, identifier: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function buildRetractUiSurface(scopeId: string): UiSurface {
  const retract = action({
    surfaceId: "retract",
    actionId: "retract.remove",
    scopeId,
    label: "Retract record",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "retract", method: "retract" },
    parameters: retractParameters(),
    confirmation: {
      mode: "required",
      title: "Retract this record?",
      detail: "This removes the named record or moves the task to dropped.",
      confirmLabel: "Retract record",
      risk: "high",
    },
    result: resultSpec("Record retracted."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "retract",
    extensionId: "retract.remove",
    title: "Retract",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 66,
    permissions: [{ kind: "capability-scope", scope: "control" }],
    nodes: [
      {
        kind: "form",
        title: "Correct durable context",
        fields: retractParameters().fields,
        submit: retract,
      },
    ],
    actions: [retract],
  };
}

export const retractUiSurfaceSource: UiSurfaceSource = {
  sourceId: "retract",
  project: (context) => [buildRetractUiSurface(context.scopeId)],
};
