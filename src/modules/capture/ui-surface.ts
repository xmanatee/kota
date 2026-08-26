import type { UiActionParameterSpec, UiSurface } from "#core/daemon/ui-surface.js";
import { action, resultSpec } from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";

function captureParameters(): UiActionParameterSpec {
  const target = {
    type: "string" as const,
    enum: ["auto", "memory", "knowledge", "tasks", "inbox"],
    default: "auto",
  };
  return {
    fields: [
      {
        id: "text",
        label: "Note",
        input: "text",
        required: true,
        schema: { type: "string" },
      },
      {
        id: "target",
        label: "Destination",
        input: "select",
        required: true,
        options: [
          { label: "Choose automatically", value: "auto" },
          { label: "Memory", value: "memory" },
          { label: "Knowledge", value: "knowledge" },
          { label: "Tasks", value: "tasks" },
          { label: "Inbox", value: "inbox" },
        ],
        schema: target,
      },
    ],
    schema: {
      type: "object",
      required: ["text", "target"],
      properties: { text: { type: "string" }, target },
      additionalProperties: false,
    },
  };
}

function buildCaptureUiSurface(scopeId: string): UiSurface {
  const capture = action({
    surfaceId: "capture",
    actionId: "capture.create",
    scopeId,
    label: "Capture note",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "capture", method: "capture" },
    parameters: captureParameters(),
    confirmation: {
      mode: "required",
      title: "Capture this note?",
      detail: "The note will be written to the selected scope store.",
      confirmLabel: "Capture note",
      risk: "low",
    },
    result: resultSpec("Note captured."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "capture",
    extensionId: "capture.write",
    title: "Capture",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 65,
    permissions: [{ kind: "capability-scope", scope: "control" }],
    nodes: [
      {
        kind: "form",
        title: "Capture a durable note",
        fields: captureParameters().fields,
        submit: capture,
      },
    ],
    actions: [capture],
  };
}

export const captureUiSurfaceSource: UiSurfaceSource = {
  sourceId: "capture",
  scope: (context) => [buildCaptureUiSurface(context.scopeId)],
};
