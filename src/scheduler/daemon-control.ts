import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PendingApproval } from "../approval-queue.js";
import type { ConversationData, ConversationRecord } from "../memory/history-utils.js";
import type { WorkflowActiveRun, WorkflowQueuedRun, WorkflowRuntimeState } from "../workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "../workflow/types.js";
import type { DaemonState } from "./daemon-state.js";

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export type DaemonControlAddress = {
  port: number;
  pid: number;
  startedAt: string;
  token: string;
};

/**
 * Capability scopes for daemon control access.
 * - read: observe daemon and workflow state, subscribe to events
 * - control: mutate workflow dispatch (pause/resume/abort/reload/trigger)
 */
export type CapabilityScope = "read" | "control";

export type WorkflowLiveStatus = {
  activeRuns: WorkflowActiveRun[];
  pendingRuns: WorkflowQueuedRun[];
  queueLength: number;
  completedRuns: number;
  totalCostUsd?: number;
  agentBackoff?: WorkflowAgentBackoffState;
  definitionsLoadedAt?: string;
  workflows: WorkflowRuntimeState["workflows"];
  paused: boolean;
};

export type DaemonLiveStatus = DaemonState & {
  running: boolean;
  workflow: WorkflowLiveStatus;
  sessions: InteractiveSession[];
};

export type DaemonSseEventType =
  | "workflow.started"
  | "workflow.completed"
  | "workflow.step.completed"
  | "queue.changed";

export type DaemonSseEvent = {
  type: DaemonSseEventType;
  payload: Record<string, unknown>;
};

export type DaemonTaskDetail = {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
  body: string;
};

export type DaemonTaskStatusResponse = {
  counts: { inbox: number; ready: number; backlog: number; doing: number; blocked: number };
  tasks: {
    doing: DaemonTaskDetail[];
    ready: DaemonTaskDetail[];
    backlog: DaemonTaskDetail[];
    blocked: DaemonTaskDetail[];
  };
};

export type InteractiveSession = {
  id: string;
  createdAt: string;
  lastActive: number;
};

export type DaemonControlHandle = {
  getDaemonLiveState(): DaemonState & { running: boolean };
  getWorkflowLiveStatus(): WorkflowLiveStatus;
  pauseWorkflowDispatch(): { already: boolean };
  resumeWorkflowDispatch(): { already: boolean };
  abortActiveRuns(): { aborted: number };
  reloadWorkflowDefinitions(): { count: number };
  enqueuePendingRun(name: string): { ok: boolean; queued?: string; alreadyQueued?: boolean; error?: string };
  subscribeToEvents(handler: (event: DaemonSseEvent) => void): () => void;
  // History
  listHistory(search?: string, limit?: number): ConversationRecord[];
  getHistory(id: string): ConversationData | null;
  deleteHistory(id: string): boolean;
  // Approvals
  listApprovals(): PendingApproval[];
  approveApproval(id: string): PendingApproval | null;
  rejectApproval(id: string, reason?: string): PendingApproval | null;
  // Tasks
  getTaskStatus(): DaemonTaskStatusResponse;
  // Interactive sessions
  registerSession(id: string, createdAt: string): void;
  unregisterSession(id: string): void;
  listSessions(): InteractiveSession[];
};

// Map each route key (method + " " + path pattern) to its required capability scope.
const ROUTE_SCOPES: Record<string, CapabilityScope> = {
  "GET /status": "read",
  "GET /workflow/status": "read",
  "GET /events": "read",
  "POST /workflow/trigger": "control",
  "POST /workflow/pause": "control",
  "POST /workflow/resume": "control",
  "POST /workflow/abort": "control",
  "POST /workflow/reload": "control",
  "GET /history": "read",
  "GET /history/:id": "read",
  "DELETE /history/:id": "control",
  "GET /approvals": "read",
  "POST /approvals/:id/approve": "control",
  "POST /approvals/:id/reject": "control",
  "GET /tasks": "read",
  "GET /sessions": "read",
  "POST /sessions/register": "control",
  "DELETE /sessions/:id": "control",
};

function extractParams(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = path.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function matchRouteKey(
  method: string,
  path: string,
): { key: string; params: Record<string, string> } | null {
  const exactKey = `${method} ${path}`;
  if (exactKey in ROUTE_SCOPES) return { key: exactKey, params: {} };
  for (const key of Object.keys(ROUTE_SCOPES)) {
    if (!key.startsWith(`${method} `)) continue;
    const pattern = key.slice(method.length + 1);
    if (!pattern.includes(":")) continue;
    const params = extractParams(pattern, path);
    if (params) return { key, params };
  }
  return null;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

export class DaemonControlServer {
  private server: Server | null = null;
  private port: number | null = null;
  private sseClients = new Set<ServerResponse>();
  private unsubscribeEvents: (() => void) | null = null;

  constructor(
    private readonly handle: DaemonControlHandle,
    private readonly token?: string,
  ) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.handleRequest(req, res);
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address() as { port: number };
        this.server = srv;
        this.port = addr.port;
        this.unsubscribeEvents = this.handle.subscribeToEvents((event) => {
          this.broadcast(event);
        });
        resolve(addr.port);
      });
      srv.once("error", reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
      for (const res of this.sseClients) {
        try { res.end(); } catch { /* ignore */ }
      }
      this.sseClients.clear();
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  getPort(): number | null {
    return this.port;
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.token) return true;
    const header = req.headers.authorization ?? "";
    return header === `Bearer ${this.token}`;
  }

  private broadcast(event: DaemonSseEvent): void {
    const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(chunk);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = req.method ?? "GET";

    const match = matchRouteKey(method, path);
    if (!match) {
      jsonResponse(res, 404, { error: "Not found" });
      return;
    }

    if (!this.isAuthorized(req)) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    const { params } = match;

    if (method === "GET" && path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(":\n\n");
      this.sseClients.add(res);
      req.on("close", () => {
        this.sseClients.delete(res);
      });
      return;
    }

    if (method === "GET" && path === "/status") {
      const daemonState = this.handle.getDaemonLiveState();
      const workflowStatus = this.handle.getWorkflowLiveStatus();
      const sessions = this.handle.listSessions();
      const body: DaemonLiveStatus = { ...daemonState, workflow: workflowStatus, sessions };
      jsonResponse(res, 200, body);
      return;
    }

    if (method === "GET" && path === "/workflow/status") {
      jsonResponse(res, 200, this.handle.getWorkflowLiveStatus());
      return;
    }

    if (method === "POST" && path === "/workflow/pause") {
      const { already } = this.handle.pauseWorkflowDispatch();
      jsonResponse(res, 200, { ok: true, paused: true, ...(already && { already: true }) });
      return;
    }

    if (method === "POST" && path === "/workflow/resume") {
      const { already } = this.handle.resumeWorkflowDispatch();
      jsonResponse(res, 200, { ok: true, paused: false, ...(already && { already: true }) });
      return;
    }

    if (method === "POST" && path === "/workflow/abort") {
      const { aborted } = this.handle.abortActiveRuns();
      jsonResponse(res, 200, { ok: true, aborted });
      return;
    }

    if (method === "POST" && path === "/workflow/reload") {
      const { count } = this.handle.reloadWorkflowDefinitions();
      jsonResponse(res, 200, { ok: true, count });
      return;
    }

    if (method === "POST" && path === "/workflow/trigger") {
      readBody(req)
        .then((buf) => {
          let body: Record<string, unknown>;
          try {
            body = JSON.parse(buf.toString()) as Record<string, unknown>;
          } catch {
            jsonResponse(res, 400, { error: "Invalid JSON body" });
            return;
          }
          const name = body.name;
          if (!name || typeof name !== "string" || !/^[a-zA-Z0-9_-]+$/.test(name)) {
            jsonResponse(res, 400, { error: "name must be a non-empty alphanumeric string" });
            return;
          }
          const result = this.handle.enqueuePendingRun(name);
          if (result.alreadyQueued) {
            jsonResponse(res, 409, { error: `Workflow "${name}" is already queued` });
            return;
          }
          if (!result.ok) {
            jsonResponse(res, 400, { error: result.error ?? "Failed to enqueue workflow" });
            return;
          }
          jsonResponse(res, 200, { ok: true, queued: result.queued });
        })
        .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
      return;
    }

    if (method === "GET" && path === "/history") {
      const search = url.searchParams.get("search") ?? undefined;
      const rawLimit = url.searchParams.has("limit") ? Number.parseInt(url.searchParams.get("limit")!, 10) : 20;
      const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 1000);
      jsonResponse(res, 200, { conversations: this.handle.listHistory(search, limit) });
      return;
    }

    if (method === "GET" && params.id && path.startsWith("/history/")) {
      const data = this.handle.getHistory(params.id);
      if (!data) {
        jsonResponse(res, 404, { error: "Conversation not found" });
        return;
      }
      jsonResponse(res, 200, data);
      return;
    }

    if (method === "DELETE" && params.id && path.startsWith("/history/")) {
      const deleted = this.handle.deleteHistory(params.id);
      if (!deleted) {
        jsonResponse(res, 404, { error: "Conversation not found" });
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && path === "/approvals") {
      jsonResponse(res, 200, { approvals: this.handle.listApprovals() });
      return;
    }

    if (method === "POST" && params.id && path.endsWith("/approve")) {
      const item = this.handle.approveApproval(params.id);
      if (!item) {
        jsonResponse(res, 404, { error: "Approval not found or not pending" });
        return;
      }
      jsonResponse(res, 200, { approval: item });
      return;
    }

    if (method === "POST" && params.id && path.endsWith("/reject")) {
      readBody(req)
        .then((buf) => {
          let reason: string | undefined;
          try {
            const body = JSON.parse(buf.toString()) as Record<string, unknown>;
            reason = typeof body.reason === "string" ? body.reason : undefined;
          } catch {
            // reason is optional
          }
          const item = this.handle.rejectApproval(params.id, reason);
          if (!item) {
            jsonResponse(res, 404, { error: "Approval not found or not pending" });
            return;
          }
          jsonResponse(res, 200, { approval: item });
        })
        .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
      return;
    }

    if (method === "GET" && path === "/tasks") {
      jsonResponse(res, 200, this.handle.getTaskStatus());
      return;
    }

    if (method === "GET" && path === "/sessions") {
      jsonResponse(res, 200, { sessions: this.handle.listSessions() });
      return;
    }

    if (method === "POST" && path === "/sessions/register") {
      readBody(req)
        .then((buf) => {
          let body: Record<string, unknown>;
          try {
            body = JSON.parse(buf.toString()) as Record<string, unknown>;
          } catch {
            jsonResponse(res, 400, { error: "Invalid JSON body" });
            return;
          }
          const id = body.id;
          const createdAt = body.createdAt;
          if (!id || typeof id !== "string" || !createdAt || typeof createdAt !== "string") {
            jsonResponse(res, 400, { error: "id and createdAt are required strings" });
            return;
          }
          this.handle.registerSession(id, createdAt);
          jsonResponse(res, 200, { ok: true });
        })
        .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
      return;
    }

    if (method === "DELETE" && params.id && path.startsWith("/sessions/")) {
      this.handle.unregisterSession(params.id);
      res.writeHead(204);
      res.end();
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  }
}
