import {
  renderUiSurface,
  type UiAction,
  type UiIntent,
  type UiNode,
  type UiSurface,
  type UiSurfaceBundle,
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

export const INTENT_ORDER: readonly UiIntent[] = ["Status", "Inbox", "Work", "Knowledge", "Setup"];

export type NavigatorFocus = "intents" | "surfaces" | "actions" | "palette" | "run-view";
export type NavigatorThemePreference = "auto" | "ascii" | "no-color";

export type NavigatorView =
  | { kind: "home" }
  | { kind: "intent"; intent: UiIntent }
  | { kind: "surface"; surfaceId: string }
  | { kind: "palette" }
  | { kind: "keys" };

export type NavigatorKeymap = {
  up: readonly string[];
  down: readonly string[];
  nextFocus: readonly string[];
  open: readonly string[];
  palette: readonly string[];
  refresh: readonly string[];
  quit: readonly string[];
};

export type NavigatorState = {
  bundle: UiSurfaceBundle;
  focus: NavigatorFocus;
  view: NavigatorView;
  selectedSurfaceId: string | null;
  selectedActionId: string | null;
  width: number;
  theme: NavigatorThemePreference;
  keymap: NavigatorKeymap;
  live: {
    subscribed: boolean;
    eventCount: number;
    lastEventId?: string;
    lastEventType?: string;
  };
  message?: { role: "info" | "warn" | "error" | "success"; text: string };
};

export type ParsedNavigatorCommand =
  | { type: "noop" }
  | { type: "quit" }
  | { type: "refresh" }
  | { type: "move"; delta: -1 | 1 }
  | { type: "next-focus" }
  | { type: "open-selected" }
  | { type: "palette" }
  | { type: "keys" }
  | { type: "resize"; width: number }
  | { type: "theme"; theme: NavigatorThemePreference }
  | { type: "intent"; intent: UiIntent }
  | { type: "surface"; surfaceId: string }
  | { type: "action"; raw: string }
  | { type: "unknown"; raw: string };

export const DEFAULT_NAVIGATOR_KEYMAP: NavigatorKeymap = {
  up: ["k", "up"],
  down: ["j", "down"],
  nextFocus: ["tab"],
  open: ["enter", "open"],
  palette: [":", "palette"],
  refresh: ["r", "refresh"],
  quit: ["q", "quit", "exit"],
};

const FOCUS_ORDER: readonly NavigatorFocus[] = ["intents", "surfaces", "actions", "run-view", "palette"];

function intentRank(intent: UiIntent): number {
  const index = INTENT_ORDER.indexOf(intent);
  return index === -1 ? INTENT_ORDER.length : index;
}

export function sortedSurfaces(bundle: UiSurfaceBundle): UiSurface[] {
  return [...bundle.surfaces].sort((a, b) =>
    intentRank(a.intent) - intentRank(b.intent) ||
    a.order - b.order ||
    a.title.localeCompare(b.title) ||
    a.surfaceId.localeCompare(b.surfaceId)
  );
}

export function selectedSurface(state: NavigatorState): UiSurface | null {
  if (state.selectedSurfaceId === null) return null;
  return state.bundle.surfaces.find((surface) => surface.surfaceId === state.selectedSurfaceId) ?? null;
}

export function createNavigatorState(args: {
  bundle: UiSurfaceBundle;
  width?: number;
  theme?: NavigatorThemePreference;
  keymap?: NavigatorKeymap;
}): NavigatorState {
  const surfaces = sortedSurfaces(args.bundle);
  return {
    bundle: args.bundle,
    focus: "surfaces",
    view: { kind: "home" },
    selectedSurfaceId: surfaces[0]?.surfaceId ?? null,
    selectedActionId: surfaces[0]?.actions[0]?.actionId ?? null,
    width: args.width ?? 100,
    theme: args.theme ?? "auto",
    keymap: args.keymap ?? DEFAULT_NAVIGATOR_KEYMAP,
    live: { subscribed: false, eventCount: 0 },
  };
}

export function withBundle(state: NavigatorState, bundle: UiSurfaceBundle): NavigatorState {
  const surfaces = sortedSurfaces(bundle);
  const current = state.selectedSurfaceId
    ? surfaces.find((surface) => surface.surfaceId === state.selectedSurfaceId)
    : null;
  const selected = current ?? surfaces[0] ?? null;
  return {
    ...state,
    bundle,
    selectedSurfaceId: selected?.surfaceId ?? null,
    selectedActionId: selected?.actions.find((action) => action.actionId === state.selectedActionId)?.actionId
      ?? selected?.actions[0]?.actionId
      ?? null,
  };
}

export function markLiveSubscribed(state: NavigatorState, subscribed: boolean): NavigatorState {
  return { ...state, live: { ...state.live, subscribed } };
}

export function markLiveEvent(state: NavigatorState, event: { id: string; type: string }): NavigatorState {
  return {
    ...state,
    live: {
      subscribed: true,
      eventCount: state.live.eventCount + 1,
      lastEventId: event.id,
      lastEventType: event.type,
    },
    message: { role: "info", text: `Live update ${event.type}` },
  };
}

export function parseNavigatorInput(raw: string, state: NavigatorState): ParsedNavigatorCommand {
  const trimmed = raw.trim();
  const input = trimmed.toLowerCase();
  if (input === "") return { type: "noop" };
  if (state.keymap.quit.includes(input)) return { type: "quit" };
  if (state.keymap.refresh.includes(input)) return { type: "refresh" };
  if (state.keymap.up.includes(input)) return { type: "move", delta: -1 };
  if (state.keymap.down.includes(input)) return { type: "move", delta: 1 };
  if (state.keymap.nextFocus.includes(input)) return { type: "next-focus" };
  if (state.keymap.open.includes(input)) return { type: "open-selected" };
  if (state.keymap.palette.includes(input)) return { type: "palette" };
  if (input === "?" || input === "h" || input === "help" || input === "keys") return { type: "keys" };
  if (input.startsWith("action ")) return { type: "action", raw: trimmed };
  if (input.startsWith("resize ")) {
    const width = Number(input.slice("resize ".length));
    if (Number.isInteger(width) && width >= 40) return { type: "resize", width };
    return { type: "unknown", raw: trimmed };
  }
  if (input.startsWith("theme ")) {
    const theme = input.slice("theme ".length);
    if (theme === "auto" || theme === "ascii" || theme === "no-color") return { type: "theme", theme };
    return { type: "unknown", raw: trimmed };
  }
  const intent = INTENT_ORDER.find((candidate) => candidate.toLowerCase() === input);
  if (intent) return { type: "intent", intent };
  const surface = findSurface(trimmed, state.bundle);
  if (surface) return { type: "surface", surfaceId: surface.surfaceId };
  return { type: "unknown", raw: trimmed };
}

export function reduceNavigatorState(state: NavigatorState, command: ParsedNavigatorCommand): NavigatorState {
  switch (command.type) {
    case "noop":
      return { ...state, view: { kind: "home" }, message: undefined };
    case "move":
      return moveSelection(state, command.delta);
    case "next-focus":
      return nextFocus(state);
    case "open-selected":
      return state.selectedSurfaceId
        ? { ...state, view: { kind: "surface", surfaceId: state.selectedSurfaceId }, message: undefined }
        : { ...state, message: { role: "warn", text: "No surface is selected." } };
    case "palette":
      return { ...state, focus: "palette", view: { kind: "palette" }, message: undefined };
    case "keys":
      return { ...state, view: { kind: "keys" }, message: undefined };
    case "resize":
      return { ...state, width: command.width, message: { role: "info", text: `Width set to ${command.width}.` } };
    case "theme":
      return { ...state, theme: command.theme, message: { role: "info", text: `Theme preference set to ${command.theme}.` } };
    case "intent": {
      const first = sortedSurfaces(state.bundle).find((surface) => surface.intent === command.intent);
      return {
        ...state,
        focus: "surfaces",
        view: { kind: "intent", intent: command.intent },
        selectedSurfaceId: first?.surfaceId ?? state.selectedSurfaceId,
        selectedActionId: first?.actions[0]?.actionId ?? state.selectedActionId,
        message: undefined,
      };
    }
    case "surface": {
      const surface = state.bundle.surfaces.find((candidate) => candidate.surfaceId === command.surfaceId);
      return {
        ...state,
        focus: "surfaces",
        view: { kind: "surface", surfaceId: command.surfaceId },
        selectedSurfaceId: command.surfaceId,
        selectedActionId: surface?.actions[0]?.actionId ?? null,
        message: undefined,
      };
    }
    case "unknown":
      return { ...state, message: { role: "warn", text: `Unknown input "${command.raw}".` } };
    case "refresh":
    case "quit":
    case "action":
      return state;
  }
}

function moveSelection(state: NavigatorState, delta: -1 | 1): NavigatorState {
  if (state.focus === "actions") {
    const surface = selectedSurface(state);
    if (!surface || surface.actions.length === 0) return state;
    const current = Math.max(0, surface.actions.findIndex((action) => action.actionId === state.selectedActionId));
    const next = (current + delta + surface.actions.length) % surface.actions.length;
    return { ...state, selectedActionId: surface.actions[next]?.actionId ?? null };
  }
  const surfaces = surfacesForCurrentView(state);
  if (surfaces.length === 0) return state;
  const current = Math.max(0, surfaces.findIndex((surface) => surface.surfaceId === state.selectedSurfaceId));
  const next = (current + delta + surfaces.length) % surfaces.length;
  const selected = surfaces[next] ?? null;
  return {
    ...state,
    selectedSurfaceId: selected?.surfaceId ?? null,
    selectedActionId: selected?.actions[0]?.actionId ?? null,
  };
}

function nextFocus(state: NavigatorState): NavigatorState {
  const current = FOCUS_ORDER.indexOf(state.focus);
  const next = FOCUS_ORDER[(current + 1) % FOCUS_ORDER.length] ?? "surfaces";
  return {
    ...state,
    focus: next,
    view: next === "palette" ? { kind: "palette" } : state.view.kind === "palette" ? { kind: "home" } : state.view,
  };
}

function surfacesForCurrentView(state: NavigatorState): UiSurface[] {
  const surfaces = sortedSurfaces(state.bundle);
  const view = state.view;
  if (view.kind === "intent") return surfaces.filter((surface) => surface.intent === view.intent);
  return surfaces;
}

function findSurface(input: string, bundle: UiSurfaceBundle): UiSurface | null {
  const surfaces = sortedSurfaces(bundle);
  const numeric = Number(input);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= surfaces.length) {
    return surfaces[numeric - 1] ?? null;
  }
  const lowered = input.toLowerCase();
  return surfaces.find((surface) =>
    surface.surfaceId.toLowerCase() === lowered ||
    surface.title.toLowerCase() === lowered
  ) ?? null;
}

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
      { spans: [span("work", "accent"), plain("  open runs, automations, modules, agents, approvals, owner questions")] },
      { spans: [span("setup", "accent"), plain("  open setup/auth requirements")] },
      { spans: [span("stores", "accent"), plain("  open memory, knowledge, and history")] },
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
      return stack(renderIntentCounts(state), blank(), renderSurfaceList(state));
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
    heading("KOTA CLI client", 1),
    line(span("Daemon-backed shared UI client.", "muted")),
    focusLine(state),
    hotkeyLine(state),
    state.message ? line(span(state.message.text, state.message.role)) : blank(),
    blank(),
    renderMainBody(state),
    blank(),
  );
}

function collectNodeEventTypes(node: UiNode, out: Set<string>): void {
  if (node.kind === "log-stream") {
    for (const eventType of node.source.eventTypes) out.add(eventType);
    return;
  }
  if (node.kind === "tabs") {
    for (const tab of node.tabs) {
      for (const child of tab.nodes) collectNodeEventTypes(child, out);
    }
  }
}

export function collectLiveEventTypes(bundle: UiSurfaceBundle): string[] {
  const eventTypes = new Set<string>();
  for (const surface of bundle.surfaces) {
    for (const node of surface.nodes) collectNodeEventTypes(node, eventTypes);
  }
  return [...eventTypes].sort();
}
