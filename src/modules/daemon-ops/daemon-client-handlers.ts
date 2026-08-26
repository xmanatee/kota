import type { ClientIdentity } from "#core/daemon/client-identity.js";
import type { DaemonLiveStatus, InteractiveSession } from "#core/daemon/daemon-control.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { scopeSelectorQuery } from "#core/server/scope-selector.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  DaemonOpsClient,
  SessionsClient,
  SessionsSetAutonomyModeResult,
} from "./client.js";
import { recordDaemonStopAttempt, stopDaemonPid } from "./daemon-ops-operations.js";
import { daemonResponseError } from "./daemon-response-error.js";
import { isServiceUnitInstalled } from "./service-install.js";

export function buildDaemonOpsDaemonHandler(link: DaemonTransport): DaemonOpsClient {
  return {
    status: async (filter) => {
      const status = await link.request<DaemonLiveStatus>(
        "GET",
        `/status${scopeSelectorQuery(filter)}`,
      );
      if (!status) throw new Error("Daemon unreachable while reading daemon status");
      return { state: "running", serviceInstalled: isServiceUnitInstalled(), status };
    },
    pid: async () => {
      const status = await link.request<DaemonLiveStatus>("GET", "/status");
      if (!status || typeof status.pid !== "number") {
        throw new Error("Daemon unreachable while reading daemon pid");
      }
      return { state: "running", pid: status.pid };
    },
    stop: async (options) => {
      const status = await link.request<DaemonLiveStatus>("GET", "/status");
      if (!status || typeof status.pid !== "number") {
        return { ok: false, reason: "not_running" };
      }
      const identity = await link.request<ClientIdentity>("GET", "/identity");
      const timeoutSec = options?.timeoutSec ?? 90;
      const result = await stopDaemonPid(status.pid, timeoutSec);
      if (!result.ok && result.reason !== "not_running" && identity?.projectDir) {
        recordDaemonStopAttempt({ projectDir: identity.projectDir, timeoutSec, result });
      }
      return result;
    },
    reload: async () => {
      const result = await link.request<{
        ok: boolean;
        workflows: number;
        changedModules: string[];
        sessionGuardrails: SessionGuardrailsReloadSummary;
      }>("POST", "/reload");
      if (!result) return { ok: false, reason: "reload_failed" };
      return {
        ok: true,
        workflows: result.workflows,
        changedModules: result.changedModules,
        sessionGuardrails: result.sessionGuardrails,
      };
    },
  };
}

type SessionsSetAutonomyModeWireBody = {
  autonomy_mode: AutonomyMode;
  source?: "daemon" | "serve";
  serveOwned?: boolean;
};

export function buildSessionsDaemonHandler(link: DaemonTransport): SessionsClient {
  return {
    list: async () => {
      const res = await link.fetchRaw("/sessions", {
        method: "GET",
        headers: link.authHeaders(),
      });
      if (!res.ok) throw await daemonResponseError(res);
      const parsed = (await res.json()) as { sessions: InteractiveSession[] };
      return { sessions: parsed.sessions };
    },
    setAutonomyMode: async (
      id: string,
      mode: AutonomyMode,
    ): Promise<SessionsSetAutonomyModeResult> => {
      const res = await link.fetchRaw(`/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({ autonomy_mode: mode }),
      });
      if (res.status === 404) return { ok: false, reason: "not_found" };
      if (!res.ok) throw await daemonResponseError(res);
      const body = (await res.json()) as SessionsSetAutonomyModeWireBody;
      return {
        ok: true,
        autonomyMode: body.autonomy_mode,
        source: body.source ?? "daemon",
        serveOwned: body.serveOwned === true,
      };
    },
  };
}
