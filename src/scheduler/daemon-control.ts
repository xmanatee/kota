import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
};

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
};

export type DaemonControlHandle = {
  getDaemonLiveState(): DaemonState & { running: boolean };
  getWorkflowLiveStatus(): WorkflowLiveStatus;
  pauseWorkflowDispatch(): { already: boolean };
  resumeWorkflowDispatch(): { already: boolean };
  abortActiveRuns(): { aborted: number };
  reloadWorkflowDefinitions(): { count: number };
  enqueuePendingRun(name: string): { ok: boolean; queued?: string; alreadyQueued?: boolean; error?: string };
};

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

export class DaemonControlServer {
  private server: Server | null = null;
  private port: number | null = null;

  constructor(private readonly handle: DaemonControlHandle) {}

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => {
        this.handleRequest(req, res);
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address() as { port: number };
        this.server = srv;
        this.port = addr.port;
        resolve(addr.port);
      });
      srv.once("error", reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
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

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "POST" && path === "/workflow/trigger") {
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

    if (req.method === "GET" && path === "/status") {
      const daemonState = this.handle.getDaemonLiveState();
      const workflowStatus = this.handle.getWorkflowLiveStatus();
      const body: DaemonLiveStatus = { ...daemonState, workflow: workflowStatus };
      jsonResponse(res, 200, body);
      return;
    }

    if (req.method === "GET" && path === "/workflow/status") {
      jsonResponse(res, 200, this.handle.getWorkflowLiveStatus());
      return;
    }

    if (req.method === "POST" && path === "/workflow/pause") {
      const { already } = this.handle.pauseWorkflowDispatch();
      jsonResponse(res, 200, { ok: true, paused: true, ...(already && { already: true }) });
      return;
    }

    if (req.method === "POST" && path === "/workflow/resume") {
      const { already } = this.handle.resumeWorkflowDispatch();
      jsonResponse(res, 200, { ok: true, paused: false, ...(already && { already: true }) });
      return;
    }

    if (req.method === "POST" && path === "/workflow/abort") {
      const { aborted } = this.handle.abortActiveRuns();
      jsonResponse(res, 200, { ok: true, aborted });
      return;
    }

    if (req.method === "POST" && path === "/workflow/reload") {
      const { count } = this.handle.reloadWorkflowDefinitions();
      jsonResponse(res, 200, { ok: true, count });
      return;
    }

    jsonResponse(res, 404, { error: "Not found" });
  }
}
