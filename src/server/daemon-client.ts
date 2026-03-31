import { join } from "node:path";
import type { PendingApproval } from "../approval-queue.js";
import { readOptionalJsonFile } from "../json-file.js";
import type { ConversationData, ConversationRecord } from "../memory/history-utils.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
  DaemonSseEvent,
  DaemonSseEventType,
  DaemonTaskStatusResponse,
  WorkflowDefinitionSummary,
  WorkflowLiveStatus,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "../scheduler/daemon-control.js";

const FETCH_TIMEOUT_MS = 2_000;

function fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export class DaemonControlClient {
  private constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  static fromStateDir(stateDir?: string): DaemonControlClient | null {
    const dir = stateDir ?? join(process.cwd(), ".kota");
    const address = readOptionalJsonFile<DaemonControlAddress>(join(dir, "daemon-control.json"));
    if (!address || typeof address.port !== "number") return null;
    return new DaemonControlClient(
      `http://127.0.0.1:${address.port}`,
      typeof address.token === "string" ? address.token : undefined,
    );
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async getDaemonStatus(): Promise<DaemonLiveStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/status`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as DaemonLiveStatus;
    } catch {
      return null;
    }
  }

  async getWorkflowStatus(): Promise<WorkflowLiveStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/status`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as WorkflowLiveStatus;
    } catch {
      return null;
    }
  }

  async getWorkflowDefinitions(): Promise<{ definitions: WorkflowDefinitionSummary[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/definitions`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { definitions: WorkflowDefinitionSummary[] };
    } catch {
      return null;
    }
  }

  async pause(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/pause`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; paused: boolean; already?: boolean };
    } catch {
      return null;
    }
  }

  async resume(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/resume`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; paused: boolean; already?: boolean };
    } catch {
      return null;
    }
  }

  async abort(): Promise<{ ok: boolean; aborted: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/abort`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; aborted: number };
    } catch {
      return null;
    }
  }

  async reload(): Promise<{ ok: boolean; count: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/reload`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; count: number };
    } catch {
      return null;
    }
  }

  async trigger(name: string): Promise<{ ok: boolean; queued?: string; alreadyQueued?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) return { ok: false, alreadyQueued: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; queued?: string };
    } catch {
      return null;
    }
  }

  async listHistory(search?: string, limit?: number): Promise<{ conversations: ConversationRecord[] } | null> {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (limit !== undefined) params.set("limit", String(limit));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetchWithTimeout(`${this.baseUrl}/history${query}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { conversations: ConversationRecord[] };
    } catch {
      return null;
    }
  }

  async getHistory(id: string): Promise<ConversationData | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/history/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as ConversationData;
    } catch {
      return null;
    }
  }

  async deleteHistory(id: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/history/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      return res.status === 204;
    } catch {
      return false;
    }
  }

  async listApprovals(): Promise<{ approvals: PendingApproval[] } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { approvals: PendingApproval[] };
    } catch {
      return null;
    }
  }

  async approveApproval(id: string): Promise<{ approval: PendingApproval } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return (await res.json()) as { approval: PendingApproval };
    } catch {
      return null;
    }
  }

  async rejectApproval(id: string, reason?: string): Promise<{ approval: PendingApproval } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/approvals/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { approval: PendingApproval };
    } catch {
      return null;
    }
  }

  async getTaskStatus(): Promise<DaemonTaskStatusResponse | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/tasks`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as DaemonTaskStatusResponse;
    } catch {
      return null;
    }
  }

  async listWorkflowRuns(workflow?: string, limit?: number): Promise<{ runs: WorkflowRunSummary[] } | null> {
    try {
      const params = new URLSearchParams();
      if (workflow) params.set("workflow", workflow);
      if (limit !== undefined) params.set("limit", String(limit));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/runs${query}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as { runs: WorkflowRunSummary[] };
    } catch {
      return null;
    }
  }

  async getWorkflowRun(id: string): Promise<WorkflowRunDetail | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/runs/${encodeURIComponent(id)}`, { headers: this.authHeaders() });
      if (!res.ok) return null;
      return (await res.json()) as WorkflowRunDetail;
    } catch {
      return null;
    }
  }

  async registerSession(id: string, createdAt: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({ id, createdAt }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async unregisterSession(id: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: this.authHeaders(),
      });
      return res.ok || res.status === 204;
    } catch {
      return false;
    }
  }

  async *events(): AsyncGenerator<DaemonSseEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/events`, { headers: this.authHeaders() });
      if (!res.ok || !res.body) return;
    } catch {
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          if (!message.trim()) continue;
          const lines = message.split("\n");
          let eventType = "";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) data = line.slice(6).trim();
          }
          if (eventType && data) {
            try {
              yield {
                type: eventType as DaemonSseEventType,
                payload: JSON.parse(data) as Record<string, unknown>,
              };
            } catch {
              // skip malformed event
            }
          }
        }
      }
    } finally {
      try { reader.cancel(); } catch { /* ignore */ }
    }
  }
}
