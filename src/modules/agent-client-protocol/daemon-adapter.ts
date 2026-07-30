import { resolve } from "node:path";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import { daemonHttpError, daemonProtocolError, responseErrorMessage } from "./daemon-adapter-errors.js";
import { mapBindingSession, mapLiveSession } from "./daemon-adapter-sessions.js";
import {
  mapDaemonSseEvent,
  permissionDecisionBody,
  readSseEvents,
} from "./daemon-adapter-sse.js";
import {
  type AcpDaemonClient,
  type AcpDaemonPermissionDecision,
  type AcpDaemonSession,
  type AcpProject,
  type AcpProjectList,
  AcpPromptCancelledError,
  type CreateSessionWireBody,
  type ProjectsWireBody,
  type PromptSessionArgs,
  type PromptSessionResult,
  type SessionBindingsWireBody,
  type SessionListWireBody,
} from "./daemon-adapter-types.js";
import { AcpProtocolError, agentMessageUpdate, sessionAlreadyLive, sessionNotFound } from "./protocol.js";

export type {
  AcpDaemonClient,
  AcpDaemonPermissionDecision,
  AcpDaemonPermissionRequest,
  AcpDaemonSession,
  AcpProject,
  AcpProjectList,
  AcpPromptUpdate,
  PromptSessionArgs,
  PromptSessionResult,
} from "./daemon-adapter-types.js";
export { AcpPromptCancelledError } from "./daemon-adapter-types.js";

export class HttpAcpDaemonClient implements AcpDaemonClient {
  constructor(
    private readonly transport: DaemonTransport,
    private readonly autonomyMode: AutonomyMode = "supervised",
  ) {}

  async listProjects(): Promise<AcpProjectList> {
    const res = await this.transport.fetchRaw("/projects", {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok) throw daemonHttpError(res.status, await responseErrorMessage(res));
    const body = (await res.json()) as ProjectsWireBody;
    return {
      projects: body.projects,
      defaultProjectId: body.defaultProjectId,
      activeProjectId: body.activeProjectId ?? null,
    };
  }

  async createSession(project: AcpProject): Promise<{ sessionId: string }> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.transport.authHeaders() },
      body: JSON.stringify({ autonomy_mode: this.autonomyMode }),
    });
    if (!res.ok) throw daemonHttpError(res.status, await responseErrorMessage(res));
    const body = (await res.json()) as CreateSessionWireBody;
    if (!body.session_id) {
      throw new AcpProtocolError(-32603, "Daemon session response did not include a session id", {
        code: "daemon_protocol_error",
      });
    }
    return { sessionId: body.session_id };
  }

  async listSessions(project: AcpProject): Promise<AcpDaemonSession[]> {
    const live = await this.listLiveSessions(project);
    const liveIds = new Set(live.map((session) => session.sessionId));
    const bindings = await this.listPersistedSessionBindings(project);
    return [...live, ...bindings.filter((session) => !liveIds.has(session.sessionId))]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async resumeSession(project: AcpProject, sessionId: string): Promise<{ sessionId: string }> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.transport.authHeaders() },
      body: JSON.stringify({ autonomy_mode: this.autonomyMode, session_id: sessionId }),
    });
    if (!res.ok) {
      if (res.status === 404) throw sessionNotFound(sessionId);
      if (res.status === 409) throw sessionAlreadyLive(sessionId);
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
    const body = (await res.json()) as CreateSessionWireBody;
    if (body.session_id !== sessionId) {
      throw new AcpProtocolError(
        -32603,
        "Daemon resume response did not match the requested session id",
        { code: "daemon_protocol_error" },
      );
    }
    return { sessionId: body.session_id };
  }

  async promptSession(args: PromptSessionArgs): Promise<PromptSessionResult> {
    let res: Response;
    try {
      res = await this.transport.fetchRaw(
        `/sessions/${encodeURIComponent(args.sessionId)}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...this.transport.authHeaders() },
          body: JSON.stringify({ message: args.prompt, client_approval: true }),
          signal: args.signal,
        },
      );
    } catch (err) {
      if (args.signal.aborted) throw new AcpPromptCancelledError();
      throw err;
    }
    if (!res.ok) {
      if (res.status === 404) throw sessionNotFound(args.sessionId);
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }

    let emittedText = false;
    let finalText = "";
    for await (const event of readSseEvents(res, args.signal)) {
      const mapped = mapDaemonSseEvent(args.sessionId, event);
      if (mapped.kind === "update") {
        emittedText = true;
        args.onUpdate(mapped.update);
      } else if (mapped.kind === "approval") {
        if (!args.requestPermission) {
          throw new AcpProtocolError(
            -32603,
            "Daemon requested client approval but no ACP permission bridge is active",
            { code: "permission_bridge_unavailable" },
          );
        }
        let decision: AcpDaemonPermissionDecision;
        try {
          decision = await args.requestPermission(mapped.request);
        } catch (err) {
          if (!args.signal.aborted) {
            await this.resolvePermission(
              args.sessionId,
              mapped.request.approvalId,
              { outcome: "cancelled", message: err instanceof Error ? err.message : String(err) },
              mapped.request.reviewDigest,
            );
          }
          throw err;
        }
        await this.resolvePermission(
          args.sessionId,
          mapped.request.approvalId,
          decision,
          mapped.request.reviewDigest,
        );
      } else if (mapped.kind === "done") {
        finalText = mapped.text;
      } else if (mapped.kind === "error") {
        throw new AcpProtocolError(-32603, mapped.message, { code: "daemon_agent_error" });
      }
    }
    if (!emittedText && finalText.length > 0) {
      args.onUpdate(agentMessageUpdate(args.sessionId, finalText));
    }
    return { stopReason: "end_turn" };
  }

  async cancelSession(sessionId: string): Promise<void> {
    const res = await this.transport.fetchRaw(`/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      method: "POST",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.deleteSession(sessionId);
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const res = await this.transport.fetchRaw(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      throw daemonHttpError(res.status, await responseErrorMessage(res));
    }
  }

  private async resolvePermission(
    sessionId: string,
    approvalId: string,
    decision: AcpDaemonPermissionDecision,
    reviewDigest?: string,
  ): Promise<void> {
    const res = await this.transport.fetchRaw(
      `/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.transport.authHeaders() },
        body: JSON.stringify(permissionDecisionBody(decision, reviewDigest)),
      },
    );
    if (!res.ok) throw daemonHttpError(res.status, await responseErrorMessage(res));
  }

  private async listLiveSessions(project: AcpProject): Promise<AcpDaemonSession[]> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions?${query.toString()}`, {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok) throw daemonHttpError(res.status, await responseErrorMessage(res));
    const entries = ((await res.json()) as SessionListWireBody).sessions;
    if (!Array.isArray(entries)) {
      throw daemonProtocolError("Daemon session list response did not include sessions");
    }
    return entries.filter((entry) => entry.source === "daemon")
      .map((entry) => mapLiveSession(project, entry));
  }

  private async listPersistedSessionBindings(project: AcpProject): Promise<AcpDaemonSession[]> {
    const query = new URLSearchParams({ projectId: project.projectId });
    const res = await this.transport.fetchRaw(`/sessions/bindings?${query.toString()}`, {
      method: "GET",
      headers: this.transport.authHeaders(),
    });
    if (!res.ok) throw daemonHttpError(res.status, await responseErrorMessage(res));
    const bindings = ((await res.json()) as SessionBindingsWireBody).bindings;
    if (!Array.isArray(bindings)) {
      throw daemonProtocolError("Daemon session bindings response did not include bindings");
    }
    return bindings.map((entry) => mapBindingSession(project, entry));
  }
}

export function resolveAcpProject(projects: AcpProjectList, cwd: string): AcpProject | null {
  const wanted = resolve(cwd);
  return projects.projects.find((project) => resolve(project.projectDir) === wanted) ?? null;
}
