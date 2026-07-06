import type {
  UiIntent,
  UiSurface,
  UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";

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
  | { type: "logs" }
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

export function surfacesForCurrentView(state: NavigatorState): UiSurface[] {
  const surfaces = sortedSurfaces(state.bundle);
  const view = state.view;
  if (view.kind === "intent") return surfaces.filter((surface) => surface.intent === view.intent);
  return surfaces;
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
