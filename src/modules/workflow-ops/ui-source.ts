import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import { buildRuntimeUiSurface } from "./ui-surface.js";

export const workflowUiSurfaceSource: UiSurfaceSource = {
  sourceId: "runs",
  scope: async (context) => {
    const [workflowStatus, runs, definitions, approvals, ownerQuestions, sessions] =
      await Promise.all([
        context.read("workflow status", () => context.client.workflow.status()),
        context.read("workflow runs", () => context.client.workflow.listRuns({ limit: 20 })),
        context.read("workflow definitions", () => context.client.workflow.listDefinitions()),
        context.read("approvals", () => context.client.approvals.list({ status: "pending" })),
        context.read("owner questions", () => context.client.ownerQuestions.list({ status: "pending" })),
        context.read("sessions", () => context.client.sessions.list()),
      ]);
    return [buildRuntimeUiSurface({
      scopeId: context.scopeId,
      workflowStatus,
      runs,
      definitions,
      approvals,
      ownerQuestions,
      sessions,
    })];
  },
};
