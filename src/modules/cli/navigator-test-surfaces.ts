import {
  buildOperatorControlUiSurface,
  type UiAction,
  type UiNode,
  type UiSurface,
  type UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";
import type { RenderNode } from "#modules/rendering/primitives.js";
import { NO_COLOR_THEME } from "#modules/rendering/theme.js";
import { renderToString } from "#modules/rendering/transport.js";
import type { NavigatorOutput, NavigatorPrompt } from "./navigator-types.js";

export function makePrompt(answers: string[]): NavigatorPrompt {
  let i = 0;
  return {
    ask: async () => (i < answers.length ? answers[i++] : null),
    close: () => {},
  };
}

export function makeOutput(): { capture: NavigatorOutput; frames: string[]; nodes: RenderNode[] } {
  const nodes: RenderNode[] = [];
  const frames: string[] = [];
  return {
    capture: {
      write: (node) => {
        nodes.push(node);
        frames.push(renderToString(node, { theme: NO_COLOR_THEME, width: 100 }).trim());
      },
    },
    frames,
    nodes,
  };
}

export function surfaceBundle(): UiSurfaceBundle {
  return {
    protocolVersion: "ui.surface.v1",
    surfaces: [buildOperatorControlUiSurface("scope-main")],
  };
}

function navigationAction(surfaceId: string, actionId: string, label: string): UiAction {
  return {
    surfaceId,
    actionId,
    scopeId: "scope-main",
    label,
    effect: "read",
    operation: { kind: "client-namespace", namespace: "workflow", method: "status" },
    confirmation: { mode: "none" },
    readiness: { state: "ready" },
    result: {
      success: { message: `${label} completed.` },
      errors: [{ reason: "unavailable", message: "Unavailable in test." }],
    },
    permissions: [
      { kind: "effect", effect: "read" },
      { kind: "capability-scope", scope: "read" },
    ],
  };
}

export function navigationSurface(args: {
  surfaceId: string;
  title: string;
  intent: UiSurface["intent"];
  order: number;
  actions: readonly UiAction[];
  nodes?: readonly UiNode[];
}): UiSurface {
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: args.surfaceId,
    extensionId: `test.${args.surfaceId}`,
    title: args.title,
    intent: args.intent,
    scopeId: "scope-main",
    attachmentPoint: { kind: "intent", intent: args.intent },
    order: args.order,
    permissions: [{ kind: "capability-scope", scope: "read" }],
    nodes: args.nodes ?? [{ kind: "text", title: args.title, body: `${args.title} body.` }],
    actions: args.actions,
  };
}

export function navigationSurfaceBundle(): UiSurfaceBundle {
  const statusActions = [
    navigationAction("status-panel", "status.refresh", "Refresh status"),
  ];
  const workActions = [
    navigationAction("work-console", "work.first", "First work action"),
    navigationAction("work-console", "work.second", "Second work action"),
  ];
  return {
    protocolVersion: "ui.surface.v1",
    surfaces: [
      navigationSurface({
        surfaceId: "status-panel",
        title: "Status Panel",
        intent: "Status",
        order: 10,
        actions: statusActions,
      }),
      navigationSurface({
        surfaceId: "work-console",
        title: "Work Console",
        intent: "Work",
        order: 20,
        actions: workActions,
      }),
    ],
  };
}
