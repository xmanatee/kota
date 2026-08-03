import type {
  UiAction,
  UiActionParameterSpec,
  UiSurface,
  UiTableRow,
} from "#core/daemon/ui-surface.js";
import {
  action,
  emptyRows,
  NAME_STATE_DETAIL_COLUMNS,
  resultSpec,
  type SurfaceRead,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { AnswerHistoryListResult } from "./client.js";

function stringParameters(args: {
  id: string;
  label: string;
}): UiActionParameterSpec {
  return {
    fields: [
      {
        id: args.id,
        label: args.label,
        input: "text",
        required: true,
        schema: { type: "string" },
      },
    ],
    schema: {
      type: "object",
      required: [args.id],
      properties: { [args.id]: { type: "string" } },
      additionalProperties: false,
    },
  };
}

function answerHistoryRows(
  history: SurfaceRead<AnswerHistoryListResult>,
  show: UiAction,
): UiTableRow[] {
  if (!history.ok) return unavailableRows(history.message);
  if (history.value.entries.length === 0) return emptyRows("Answer history");
  return history.value.entries.map((entry) => ({
    id: entry.id,
    cells: [
      { columnId: "name", value: entry.query, role: "info" },
      {
        columnId: "state",
        value: entry.result.ok ? "answered" : entry.result.reason,
        role: entry.result.ok ? "success" : "warn",
      },
      { columnId: "detail", value: entry.createdAt, role: "muted" },
    ],
    action: show,
  }));
}

function buildAnswerUiSurface(
  scopeId: string,
  history: SurfaceRead<AnswerHistoryListResult>,
): UiSurface {
  const queryParameters = stringParameters({ id: "query", label: "Question" });
  const showParameters = stringParameters({ id: "answerId", label: "Answer id" });
  const answer = action({
    surfaceId: "answers",
    actionId: "answer.query",
    scopeId,
    label: "Compose cited answer",
    operation: { kind: "client-namespace", namespace: "answer", method: "answer" },
    parameters: queryParameters,
    result: resultSpec("Answer composed."),
  });
  const refresh = action({
    surfaceId: "answers",
    actionId: "answer.log",
    scopeId,
    label: "Reload answer history",
    operation: { kind: "client-namespace", namespace: "answer", method: "log" },
    result: resultSpec("Answer history loaded."),
  });
  const show = action({
    surfaceId: "answers",
    actionId: "answer.show",
    scopeId,
    label: "Open answer",
    operation: { kind: "client-namespace", namespace: "answer", method: "show" },
    parameters: showParameters,
    result: resultSpec("Answer loaded."),
  });
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "answers",
    extensionId: "answer.cited",
    title: "Cited Answers",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 64,
    refreshEvents: [
      "knowledge.create",
      "knowledge.update",
      "knowledge.delete",
      "task.changed",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [
      {
        kind: "form",
        title: "Ask with citations",
        fields: queryParameters.fields,
        submit: answer,
      },
      {
        kind: "table",
        title: "Answer history",
        columns: NAME_STATE_DETAIL_COLUMNS,
        rows: answerHistoryRows(history, show),
      },
      {
        kind: "form",
        title: "Open a persisted answer",
        fields: showParameters.fields,
        submit: show,
      },
      { kind: "action-list", title: "Answer actions", actions: [refresh] },
    ],
    actions: [answer, refresh, show],
  };
}

export const answerUiSurfaceSource: UiSurfaceSource = {
  sourceId: "answers",
  project: async (context) => {
    const history = await context.read("answer history", () =>
      context.client.answer.log({ limit: 10 }),
    );
    return [buildAnswerUiSurface(context.scopeId, history)];
  },
};
