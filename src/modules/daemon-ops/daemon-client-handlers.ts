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
      if (!result.ok && result.reason !== "not_running" && identity?.scopeRoot) {
        recordDaemonStopAttempt({ scopeRoot: identity.scopeRoot, timeoutSec, result });
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

type SessionsCreateWireBody = {
  session_id?: unknown;
};

function parseDaemonChatResult(text: string): string {
  let result: string | undefined;
  for (const frame of text.split(/\r?\n\r?\n/)) {
    if (frame.trim().length === 0) continue;
    let event = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trimStart();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (event.length === 0 || dataLines.length === 0) continue;
    const decoded = JSON.parse(dataLines.join("\n")) as unknown;
    if (
      decoded === null || typeof decoded !== "object" ||
      Array.isArray(decoded)
    ) {
      throw new Error("Daemon one-shot session returned malformed SSE data");
    }
    const payload = decoded as Record<string, unknown>;
    if (event === "error") {
      throw new Error(
        typeof payload.message === "string"
          ? payload.message
          : "Daemon one-shot session failed",
      );
    }
    if (event === "done") {
      if (result !== undefined) {
        throw new Error("Daemon one-shot session returned multiple results");
      }
      if (typeof payload.result !== "string") {
        throw new Error("Daemon one-shot session returned no text result");
      }
      result = payload.result;
    }
  }
  if (result === undefined) {
    throw new Error("Daemon one-shot session ended without a result");
  }
  return result;
}

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
    runOneShot: async (prompt, options) => {
      if (prompt.trim().length === 0) {
        throw new Error("One-shot session prompt must be non-empty");
      }
      const create = await link.fetchRaw("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({
          autonomy_mode: options?.autonomyMode ?? "passive",
        }),
      });
      if (!create.ok) throw await daemonResponseError(create);
      const created = (await create.json()) as SessionsCreateWireBody;
      if (typeof created.session_id !== "string" || created.session_id.length === 0) {
        throw new Error("Daemon session response did not include a session id");
      }
      const sessionId = created.session_id;
      let text: string | undefined;
      let operationError: unknown;
      try {
        const chat = await link.fetchRaw(
          `/sessions/${encodeURIComponent(sessionId)}/chat`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...link.authHeaders(),
            },
            body: JSON.stringify({
              message: prompt,
              ...(options?.agentBackoff === undefined
                ? {}
                : { agent_backoff: options.agentBackoff }),
            }),
          },
        );
        if (!chat.ok) throw await daemonResponseError(chat);
        text = parseDaemonChatResult(await chat.text());
      } catch (error) {
        operationError = error;
      }
      try {
        const closed = await link.fetchRaw(
          `/sessions/${encodeURIComponent(sessionId)}`,
          { method: "DELETE", headers: link.authHeaders() },
        );
        if (!closed.ok && closed.status !== 404) {
          throw await daemonResponseError(closed);
        }
      } catch (error) {
        if (operationError === undefined) operationError = error;
      }
      if (operationError !== undefined) throw operationError;
      if (text === undefined) {
        throw new Error("Daemon one-shot session completed without text");
      }
      return { ok: true, text };
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
