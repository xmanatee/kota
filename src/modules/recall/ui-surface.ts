import type { UiActionParameterSpec, UiSurface } from "#core/daemon/ui-surface.js";
import { action, resultSpec } from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";

function recallParameters(): UiActionParameterSpec {
  return {
    fields: [
      {
        id: "query",
        label: "What do you want to recall?",
        input: "text",
        required: true,
        schema: { type: "string" },
      },
      {
        id: "topK",
        label: "Maximum results",
        input: "number",
        required: false,
        schema: { type: "integer", default: 10, minimum: 1, maximum: 50 },
      },
    ],
    schema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        topK: { type: "integer", default: 10, minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  };
}

function buildRecallUiSurface(scopeId: string): UiSurface {
  const recall = action({
    surfaceId: "recall",
    actionId: "recall.query",
    scopeId,
    label: "Recall across stores",
    operation: { kind: "client-namespace", namespace: "recall", method: "recall" },
    parameters: recallParameters(),
    result: resultSpec("Recall completed."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "recall",
    extensionId: "recall.search",
    title: "Recall",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 63,
    refreshEvents: [
      "knowledge.create",
      "knowledge.update",
      "knowledge.delete",
      "task.changed",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "text",
        title: "Cross-store search",
        body: "Search knowledge, memory, conversation history, tasks, and prior cited answers through one ranked query.",
        role: "muted",
      },
      { kind: "form", title: "Recall", fields: recallParameters().fields, submit: recall },
    ],
    actions: [recall],
  };
}

export const recallUiSurfaceSource: UiSurfaceSource = {
  sourceId: "recall",
  scope: (context) => [buildRecallUiSurface(context.scopeId)],
};
