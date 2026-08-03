import type { UiSurface } from "#core/daemon/ui-surface.js";
import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import { renderOnDemandDigest } from "./on-demand.js";

function buildDailyDigestUiSurface(scopeId: string, body: string): UiSurface {
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "daily-digest",
    extensionId: "autonomy.daily-digest",
    title: "Daily Digest",
    intent: "Knowledge",
    scopeId,
    attachmentPoint: { kind: "intent", intent: "Knowledge" },
    order: 67,
    refreshEvents: [
      "workflow.completed",
      "task.changed",
      "owner.question.changed",
      "owner.question.resolved",
    ],
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: [{ kind: "detail", title: "Rolling 24-hour digest", body }],
    actions: [],
  };
}

export const dailyDigestUiSurfaceSource: UiSurfaceSource = {
  sourceId: "daily-digest",
  project: (context) => {
    const digest = renderOnDemandDigest({ projectDir: context.cwd });
    return [buildDailyDigestUiSurface(context.scopeId, digest.text)];
  },
};
