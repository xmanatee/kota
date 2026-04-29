/**
 * Thin-client identity contract — the typed payload every daemon client
 * uses to discover *which* project/daemon it is talking to and whether
 * the embedded dashboard is reachable.
 *
 * The shape is intentionally small and stable. Clients consume it through
 * `GET /identity` so they never need to read `.kota/daemon-control.json`
 * to derive a project name, infer dashboard URLs from hardcoded ports, or
 * collapse "wrong project" / "no control file" / "remote URL configured"
 * into one ambiguous "Daemon offline" string.
 */

import { basename } from "node:path";
import type { CapabilityReadinessResponse } from "./capability-readiness.js";

/**
 * Stable capability id the daemon's `web` module registers when the
 * embedded dashboard build is present. Documented here because the
 * identity payload depends on this exact id.
 */
export const DASHBOARD_CAPABILITY_ID = "dashboard";

/**
 * Stable capability id the daemon registers directly when at least one
 * workflow definition is enabled.
 */
export const WORKFLOW_TRIGGER_CAPABILITY_ID = "workflow.trigger";

/**
 * Dashboard availability shape inside {@link ClientIdentity}.
 *
 * - `available: true` — the daemon serves the dashboard at `path`
 *   relative to its own base URL. Clients should construct
 *   `<daemon-base-url><path>` to open it. The server emits a path rather
 *   than a fully qualified URL because the request host the client used
 *   to reach the daemon (loopback, LAN IP, remote tunnel) is the same
 *   host that should serve the dashboard.
 *
 * - `available: false` — the dashboard is not currently usable. `reason`
 *   is the same machine-readable code the contributing capability source
 *   reported (`web_ui_not_built`, `module_disabled`, `init_failed`, …),
 *   and `message` is a short operator-facing line. Clients should hide,
 *   disable, or explain the dashboard control instead of opening a
 *   broken URL.
 */
export type ClientDashboardAvailability =
  | {
      available: true;
      path: string;
    }
  | {
      available: false;
      reason: string;
      message?: string;
    };

/**
 * Typed identity payload returned by `GET /identity`.
 *
 * - `projectName` is a short label derived from the project directory's
 *   basename. It is stable for one project but is not unique across
 *   different roots with the same final segment — `projectDir` is the
 *   authoritative identity.
 * - `projectDir` is the absolute path the daemon was launched against.
 * - `daemonVersion` mirrors the version string `GET /health` reports.
 * - `pid` and `startedAt` mirror `daemon-state.json` so a client can tell
 *   "same daemon" from "daemon was restarted".
 * - `dashboard` describes whether opening the embedded dashboard is
 *   meaningful; clients should not hardcode dashboard URLs.
 */
export type ClientIdentity = {
  projectName: string;
  projectDir: string;
  daemonVersion: string;
  pid: number;
  startedAt: string;
  dashboard: ClientDashboardAvailability;
};

/**
 * Daemon version surfaced by `GET /health` and `GET /identity`. Kept here
 * so a single source of truth backs both routes.
 */
export const DAEMON_PROTOCOL_VERSION = "0.1.0";

/**
 * Static path the embedded dashboard is served from when its capability
 * is `ready`. The `web` module's static-route contributions register
 * `/` (and `/index.html`) — the path stays trailing-slashed so clients
 * can join it onto the daemon base URL without further normalization.
 */
const DASHBOARD_PATH = "/";

/**
 * Build the typed identity payload from the inputs the daemon already
 * has: project root, daemon-state metadata, and a freshly probed
 * capability readiness response.
 *
 * The function is deliberately pure so tests can drive it without
 * spinning up an HTTP server.
 */
export function buildClientIdentity(opts: {
  projectDir: string;
  pid: number;
  startedAt: string;
  capabilities: CapabilityReadinessResponse;
}): ClientIdentity {
  const dashboardCap = opts.capabilities.capabilities.find(
    (c) => c.id === DASHBOARD_CAPABILITY_ID,
  );
  let dashboard: ClientDashboardAvailability;
  if (dashboardCap && dashboardCap.status === "ready") {
    dashboard = { available: true, path: DASHBOARD_PATH };
  } else if (dashboardCap) {
    dashboard = {
      available: false,
      reason: dashboardCap.reason ?? dashboardCap.status,
      ...(dashboardCap.message !== undefined && { message: dashboardCap.message }),
    };
  } else {
    dashboard = {
      available: false,
      reason: "not_contributed",
      message:
        "No module contributed a dashboard capability. The web client is not loaded in this daemon.",
    };
  }
  return {
    projectName: basename(opts.projectDir) || opts.projectDir,
    projectDir: opts.projectDir,
    daemonVersion: DAEMON_PROTOCOL_VERSION,
    pid: opts.pid,
    startedAt: opts.startedAt,
    dashboard,
  };
}
