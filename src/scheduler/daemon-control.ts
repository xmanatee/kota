import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { WorkflowActiveRun, WorkflowQueuedRun, WorkflowRuntimeState } from "../workflow/run-types.js";
import type { WorkflowAgentBackoffState } from "../workflow/types.js";
import type { DaemonState } from "./daemon-state.js";

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
