import {
  renderUiSurface,
  type UiAction,
  type UiSurface,
} from "#modules/daemon-ops/operator-ui.js";
import {
  blank,
  heading,
  line,
  list,
  plain,
  type RenderNode,
  sectionRule,
  span,
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import { renderOverview, renderRunSupervisionShortcut } from "./navigator-overview-render.js";
import {
  INTENT_ORDER,
  type NavigatorState,
  sortedSurfaces,
  surfacesForCurrentView,
} from "./navigator-state.js";

function focusLine(state: NavigatorState): RenderNode {
  const liveRole = state.live.subscribed ? "success" : "warn";
  return line(
    span(`focus:${state.focus}`, "accent"),
    plain("  "),
    span(`width:${state.width}`, "muted"),
    plain("  "),
    span(`theme:${state.theme}`, "muted"),
    plain("  "),
    span(`live:${state.live.subscribed ? "event-stream" : "not subscribed"} ${state.live.eventCount}`, liveRole),
    state.live.lastEventType ? plain(`  ${state.live.lastEventType}`) : plain(""),
  );
}

function hotkeyLine(state: NavigatorState): RenderNode {
  return line(
    span(`${state.keymap.down[0]}/${state.keymap.up[0]}`, "accent"),
    plain(" move  "),
    span(state.keymap.nextFocus[0] ?? "tab", "accent"),
    plain(" focus  "),
    span(state.keymap.open[0] ?? "enter", "accent"),
    plain(" open  "),
    span(state.keymap.palette[0] ?? ":", "accent"),
    plain(" palette  "),
    span(state.keymap.refresh[0] ?? "r", "accent"),
    plain(" refresh  "),
    span(state.keymap.quit[0] ?? "q", "accent"),
    plain(" quit"),
  );
}

function renderIntentCounts(state: NavigatorState): RenderNode {
  const surfaces = sortedSurfaces(state.bundle);
  return stack(
    sectionRule("Intents"),
    list(INTENT_ORDER.map((intent) => {
      const count = surfaces.filter((surface) => surface.intent === intent).length;
      const selected = state.view.kind === "intent" && state.view.intent === intent;
      return {
        spans: [
          span(selected ? ">" : " ", selected ? "accent" : "muted"),
          plain(" "),
          span(intent, count > 0 ? "accent" : "muted", selected),
          plain("  "),
          span(`${count}`, count > 0 ? "info" : "muted"),
        ],
      };
    })),
  );
}

function renderSurfaceList(state: NavigatorState, surfaces = surfacesForCurrentView(state)): RenderNode {
  if (surfaces.length === 0) {
    return stack(sectionRule("Surfaces"), line(span("No shared UI surfaces are available for this view.", "warn")));
  }
  return stack(
    sectionRule("Surfaces"),
    ...surfaces.map((surface, index) =>
      line(
        span(state.selectedSurfaceId === surface.surfaceId ? ">" : " ", state.selectedSurfaceId === surface.surfaceId ? "accent" : "muted"),
        plain(" "),
        span(`${index + 1}`.padStart(2, " "), "muted"),
        plain("  "),
        span(surface.surfaceId, "accent"),
        plain("  "),
        span(surface.intent, "muted"),
        plain("  "),
        plain(surface.title),
        plain("  "),
        span(surface.scopeId, "muted"),
      )
    ),
  );
}

function operationLabel(action: UiAction): string {
  if (action.operation.kind === "daemon-route") return `${action.operation.method} ${action.operation.path}`;
  return `${action.operation.namespace}.${action.operation.method}`;
}

function renderSurfaceActions(surface: UiSurface, selectedActionId: string | null): RenderNode {
  if (surface.actions.length === 0) {
    return stack(sectionRule("Actions"), line(span("No actions exposed by this surface.", "muted")));
  }
  return stack(
    sectionRule("Actions"),
    list(surface.actions.map((action) => ({
      spans: [
        span(selectedActionId === action.actionId ? ">" : " ", selectedActionId === action.actionId ? "accent" : "muted"),
        plain(" "),
        span(action.actionId, "accent"),
        plain("  "),
        plain(action.label),
        plain("  "),
        span(action.effect, action.effect === "read" ? "muted" : "warn"),
        plain("  "),
        span(action.readiness.state, action.readiness.state === "ready" ? "success" : "warn"),
        plain("  "),
        span(operationLabel(action), "muted"),
      ],
    }))),
  );
}

function renderPalette(state: NavigatorState): RenderNode {
  return stack(
    sectionRule("Command palette"),
    list([
      { spans: [span("status", "accent"), plain("  open status surfaces")] },
      { spans: [span("work / runs", "accent"), plain("  open run supervision, automations, approvals, owner questions")] },
      { spans: [span("setup", "accent"), plain("  open setup/auth requirements")] },
      { spans: [span("modules / agents", "accent"), plain("  open loaded module and agent status")] },
      { spans: [span("stores", "accent"), plain("  open memory, knowledge, and history")] },
      { spans: [span("logs", "accent"), plain("  open the live run event stream")] },
      { spans: [span("action <surface> <action> [--yes] [json]", "accent"), plain("  execute a typed action")] },
      { spans: [span("resize 120", "accent"), plain("  update layout width")] },
      { spans: [span("theme ascii", "accent"), plain("  set navigator theme preference")] },
    ]),
    renderSurfaceList(state),
  );
}

function renderKeys(state: NavigatorState): RenderNode {
  return stack(
    sectionRule("Keybindings"),
    list([
      { spans: [span(state.keymap.up.join(", "), "accent"), plain("  move selection up")] },
      { spans: [span(state.keymap.down.join(", "), "accent"), plain("  move selection down")] },
      { spans: [span(state.keymap.nextFocus.join(", "), "accent"), plain("  cycle focus")] },
      { spans: [span(state.keymap.open.join(", "), "accent"), plain("  open selected surface")] },
      { spans: [span(state.keymap.palette.join(", "), "accent"), plain("  command palette")] },
      { spans: [span(state.keymap.refresh.join(", "), "accent"), plain("  refresh shared UI graph")] },
      { spans: [span("l, logs", "accent"), plain("  open live run event stream")] },
      { spans: [span(state.keymap.quit.join(", "), "accent"), plain("  quit")] },
    ]),
  );
}

function renderSurfaceView(state: NavigatorState, surface: UiSurface): RenderNode {
  return stack(renderUiSurface(surface), renderSurfaceActions(surface, state.selectedActionId));
}

function renderMainBody(state: NavigatorState): RenderNode {
  switch (state.view.kind) {
    case "home":
      return stack(renderOverview(state), blank(), renderRunSupervisionShortcut(state), blank(), renderIntentCounts(state), blank(), renderSurfaceList(state));
    case "intent": {
      const view = state.view;
      const surfaces = sortedSurfaces(state.bundle).filter((surface) => surface.intent === view.intent);
      return stack(
        heading(view.intent, 2),
        renderSurfaceList(state, surfaces),
        ...surfaces.flatMap((surface) => [blank(), renderSurfaceView(state, surface)]),
      );
    }
    case "surface": {
      const view = state.view;
      const surface = state.bundle.surfaces.find((candidate) => candidate.surfaceId === view.surfaceId);
      return surface ? renderSurfaceView(state, surface) : statusBanner("warn", "Surface unavailable", view.surfaceId);
    }
    case "palette":
      return renderPalette(state);
    case "keys":
      return renderKeys(state);
  }
}

export function renderNavigatorFrame(state: NavigatorState): RenderNode {
  return stack(
    heading("KOTA Terminal Client", 1),
    line(span("KOTA CLI client. Daemon-backed shared UI client. Status, Work/Runs, Inbox, Setup, Modules/Agents, and Stores are controlled through the shared action protocol.", "muted")),
    focusLine(state),
    hotkeyLine(state),
    state.message ? line(span(state.message.text, state.message.role)) : blank(),
    blank(),
    renderMainBody(state),
    blank(),
  );
}
