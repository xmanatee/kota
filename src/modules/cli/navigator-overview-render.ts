import type {
  UiNode,
  UiRole,
  UiStatusEntry,
  UiSurface,
} from "#modules/daemon-ops/operator-ui.js";
import {
  kvBlock,
  line,
  list,
  plain,
  type RenderNode,
  sectionRule,
  span,
  stack,
  statusBanner,
} from "#modules/rendering/primitives.js";
import type { NavigatorState } from "./navigator-state.js";

function statusEntries(surface: UiSurface | undefined): readonly UiStatusEntry[] {
  const node = surface?.nodes.find((candidate): candidate is Extract<UiNode, { kind: "status-summary" }> =>
    candidate.kind === "status-summary"
  );
  return node?.entries ?? [];
}

function entryFor(surface: UiSurface | undefined, label: string): UiStatusEntry | null {
  return statusEntries(surface).find((entry) => entry.label.toLowerCase() === label.toLowerCase()) ?? null;
}

function roleFor(entry: UiStatusEntry | null, fallback: UiRole = "muted"): UiRole {
  return entry?.role ?? fallback;
}

function valueFor(entry: UiStatusEntry | null, fallback = "unavailable"): string {
  return entry?.value ?? fallback;
}

function numberEntry(surface: UiSurface | undefined, label: string): number {
  const raw = entryFor(surface, label)?.value;
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function setupGapSummary(setup: UiSurface | undefined): { value: string; role: UiRole } {
  if (!setup) return { value: "unavailable", role: "warn" };
  const labels = ["missing", "pending", "expired", "revoked", "unavailable"];
  const parts = labels
    .map((label) => [label, numberEntry(setup, label)] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`);
  if (parts.length === 0) return { value: "none", role: "success" };
  return { value: parts.join(", "), role: "warn" };
}

function liveEventLabel(state: NavigatorState): { value: string; role: UiRole } {
  if (!state.live.subscribed) return { value: "not subscribed", role: "warn" };
  const suffix = state.live.lastEventType ? `; last ${state.live.lastEventType}` : "";
  return { value: `${state.live.eventCount} received${suffix}`, role: "success" };
}

function renderOfflineState(): RenderNode {
  return stack(
    statusBanner("warn", "Daemon offline or shared UI unavailable", "Start with `kota daemon start`, then press r to reconnect."),
    sectionRule("Offline controls"),
    list([
      { spans: [span("start", "accent"), plain("  `kota daemon start`")] },
      { spans: [span("reconnect", "accent"), plain("  press r or type refresh")] },
      { spans: [span("scripted", "accent"), plain("  use one-shot commands such as `kota status`, `kota inbox`, or `kota run <prompt>`")] },
    ]),
  );
}

export function renderOverview(state: NavigatorState): RenderNode {
  if (state.bundle.surfaces.length === 0) return renderOfflineState();
  const status = state.bundle.surfaces.find((surface) => surface.surfaceId === "status");
  const scopes = state.bundle.surfaces.find((surface) => surface.surfaceId === "scopes");
  const runs = state.bundle.surfaces.find((surface) => surface.surfaceId === "runs");
  const inbox = state.bundle.surfaces.find((surface) => surface.surfaceId === "inbox");
  const setup = state.bundle.surfaces.find((surface) => surface.surfaceId === "setup");
  const daemon = entryFor(status, "Daemon");
  const dispatch = entryFor(runs, "Dispatch") ?? entryFor(status, "Dispatch");
  const active = entryFor(runs, "Active");
  const queued = entryFor(runs, "Queued");
  const setupGaps = setupGapSummary(setup);
  const live = liveEventLabel(state);
  return stack(
    sectionRule("Operator overview"),
    kvBlock([
      { label: "Daemon", value: valueFor(daemon), role: roleFor(daemon, "warn") },
      { label: "Project", value: valueFor(entryFor(scopes, "Active"), status?.scopeId ?? "unavailable"), role: roleFor(entryFor(scopes, "Active")) },
      { label: "Dispatch", value: valueFor(dispatch), role: roleFor(dispatch, "warn") },
      {
        label: "Active / queued",
        value: `${valueFor(active, "0")} active, ${valueFor(queued, "0")} queued`,
        role: numberEntry(runs, "Active") > 0 || numberEntry(runs, "Queued") > 0 ? "warn" : "muted",
      },
      {
        label: "Inbox",
        value: `${numberEntry(inbox, "Approvals")} approvals, ${numberEntry(inbox, "Owner questions")} owner questions, ${numberEntry(inbox, "Failed runs")} failed runs`,
        role: numberEntry(inbox, "Approvals") + numberEntry(inbox, "Owner questions") + numberEntry(inbox, "Failed runs") > 0 ? "warn" : "muted",
      },
      { label: "Setup gaps", value: setupGaps.value, role: setupGaps.role },
      { label: "Live events", value: live.value, role: live.role },
    ]),
  );
}

export function renderRunSupervisionShortcut(state: NavigatorState): RenderNode {
  const runs = state.bundle.surfaces.find((surface) => surface.surfaceId === "runs");
  if (!runs) {
    return stack(
      sectionRule("Run supervision"),
      line(span("No Work/Runs surface is exposed by the current UI bundle.", "warn")),
    );
  }
  const writeActions = runs.actions.filter((action) => action.effect !== "read");
  return stack(
    sectionRule("Run supervision"),
    line(
      span("runs", "accent"),
      plain(" opens active, queued, and recent runs; "),
      span("l", "accent"),
      plain(" opens live events; "),
      span("tab", "accent"),
      plain(" focuses actions; "),
      span("enter", "accent"),
      plain(" executes the selected action."),
    ),
    list(writeActions.map((action) => ({
      spans: [
        span(action.actionId, "accent"),
        plain("  "),
        plain(action.label),
        plain("  "),
        span(action.readiness.state, action.readiness.state === "ready" ? "success" : "warn"),
        action.readiness.state === "ready" ? plain("") : plain(`  ${action.readiness.message}`),
      ],
    }))),
  );
}
