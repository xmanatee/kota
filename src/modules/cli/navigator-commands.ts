import type { UiSurface, UiSurfaceBundle } from "#modules/daemon-ops/operator-ui.js";
import { surfaceWithLogStream } from "./navigator-live-events.js";
import {
  INTENT_ORDER,
  type NavigatorFocus,
  type NavigatorState,
  type ParsedNavigatorCommand,
  selectedSurface,
  sortedSurfaces,
  surfacesForCurrentView,
} from "./navigator-state.js";

const FOCUS_ORDER: readonly NavigatorFocus[] = ["intents", "surfaces", "actions", "run-view", "palette"];

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
  if (input === "logs" || input === "follow") return { type: "logs" };
  if (input === "runtime" || input === "runs") return surfaceCommand("runs", state);
  if (input === "modules" || input === "agents") return surfaceCommand("modules-agents", state);
  if (input === "stores" || input === "memory" || input === "knowledge" || input === "history") return surfaceCommand("stores", state);
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
    case "logs": {
      const runSurface = surfaceWithLogStream(state.bundle) ?? state.bundle.surfaces.find((surface) => surface.surfaceId === "runs");
      return runSurface
        ? {
            ...state,
            focus: "run-view",
            view: { kind: "surface", surfaceId: runSurface.surfaceId },
            selectedSurfaceId: runSurface.surfaceId,
            selectedActionId: runSurface.actions[0]?.actionId ?? null,
            message: { role: "info", text: "Live run event stream selected. Open Work/Runs actions for abort, pause, resume, and refresh controls." },
          }
        : { ...state, message: { role: "warn", text: "No live run stream is exposed by the current shared UI bundle." } };
    }
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

function surfaceCommand(surfaceId: string, state: NavigatorState): ParsedNavigatorCommand {
  const surface = state.bundle.surfaces.find((candidate) => candidate.surfaceId === surfaceId);
  return surface ? { type: "surface", surfaceId: surface.surfaceId } : { type: "unknown", raw: surfaceId };
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
