import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
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
  readRole,
  readValue,
  resultSpec,
  type SurfaceRead,
  shortId,
  unavailableRows,
} from "#core/daemon/ui-surface-builders.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import type { OwnerQuestionsListResult } from "./client.js";

function resolutionParameters(): UiActionParameterSpec {
  return {
    fields: [
      { id: "questionId", label: "Question id", input: "text", required: true },
      {
        id: "decision",
        label: "Decision",
        input: "select",
        required: true,
        options: [
          { label: "Answer", value: "answer" },
          { label: "Dismiss", value: "dismiss" },
        ],
      },
      { id: "answer", label: "Answer", input: "multiline", required: false },
      { id: "reason", label: "Dismissal reason", input: "multiline", required: false },
    ],
    schema: {
      type: "object",
      required: ["questionId", "decision"],
      properties: {
        questionId: { type: "string" },
        decision: { type: "string", enum: ["answer", "dismiss"] },
        answer: { type: "string" },
        reason: { type: "string" },
      },
      additionalProperties: false,
    },
  };
}

function resolutionAction(scopeId: string, question: PendingOwnerQuestion): UiAction {
  return action({
    surfaceId: "owner-questions",
    actionId: `owner-question.resolve-${question.id}`,
    scopeId,
    label: "Resolve question",
    effect: "write",
    operation: { kind: "client-namespace", namespace: "ownerQuestions", method: "resolve" },
    parameters: resolutionParameters(),
    confirmation: {
      mode: "required",
      title: "Resolve owner question",
      detail: "The waiting session or workflow may continue after this decision is recorded.",
      confirmLabel: "Apply decision",
      risk: "medium",
    },
    result: resultSpec("Owner question resolved."),
  });
}

function questionDetail(question: PendingOwnerQuestion): string {
  const proposals = question.proposedAnswers?.length
    ? ` · proposed: ${question.proposedAnswers.join(" | ")}`
    : "";
  const context = question.context ? ` · context: ${question.context}` : "";
  return `${question.question} · why: ${question.reason}${context}${proposals}`;
}

function questionRows(
  questions: SurfaceRead<OwnerQuestionsListResult>,
  actions: ReadonlyMap<string, UiAction>,
): UiTableRow[] {
  if (!questions.ok) return unavailableRows(questions.message);
  if (questions.value.questions.length === 0) return emptyRows("Owner questions");
  return questions.value.questions.map((question) => ({
    id: question.id,
    cells: [
      { columnId: "name", value: shortId(question.id), role: "warn" },
      { columnId: "state", value: question.status, role: "warn" },
      { columnId: "detail", value: questionDetail(question), role: "muted" },
    ],
    action: actions.get(question.id),
  }));
}

function buildOwnerQuestionsUiSurface(
  scopeId: string,
  questions: SurfaceRead<OwnerQuestionsListResult>,
): UiSurface {
  const refresh = action({
    surfaceId: "owner-questions",
    actionId: "owner-questions.list",
    scopeId,
    label: "Reload owner questions",
    operation: { kind: "client-namespace", namespace: "ownerQuestions", method: "list" },
    result: resultSpec("Owner questions loaded."),
  });
  const questionActions = questions.ok
    ? questions.value.questions.map((question) => resolutionAction(scopeId, question))
    : [];
  const actionsById = new Map(
    questionActions.map((candidate, index) => [questions.ok ? questions.value.questions[index]!.id : "", candidate]),
  );

  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "owner-questions",
    extensionId: "owner-questions.review",
    title: "Owner Questions",
    intent: "Inbox",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Inbox" },
    order: 25,
    refreshEvents: [
      "owner.question.asked",
      "owner.question.changed",
      "owner.question.resolved",
      "owner.question.dismissed",
      "owner.question.expired",
    ],
    permissions: [
      { kind: "capability-scope", scope: "control" },
      { kind: "effect", effect: "write" },
    ],
    nodes: [
      {
        kind: "status-summary",
        entries: [{
          label: "Pending questions",
          value: readValue(questions, (value) => `${value.questions.length}`),
          role: readRole(questions),
        }],
      },
      {
        kind: "table",
        title: "Questions waiting on the owner",
        columns: NAME_STATE_DETAIL_COLUMNS,
        rows: questionRows(questions, actionsById),
      },
      { kind: "action-list", title: "Question actions", actions: [refresh, ...questionActions] },
    ],
    actions: [refresh, ...questionActions],
  };
}

export const ownerQuestionsUiSurfaceSource: UiSurfaceSource = {
  sourceId: "owner-questions",
  project: async (context) => {
    const questions = await context.read("owner questions", () =>
      context.client.ownerQuestions.list({ status: "pending" }),
    );
    return [buildOwnerQuestionsUiSurface(context.scopeId, questions)];
  },
};
