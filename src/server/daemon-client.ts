import { join } from "node:path";
import { readOptionalJsonFile } from "../json-file.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
  DaemonSseEvent,
  DaemonSseEventType,
  WorkflowLiveStatus,
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
  private constructor(private readonly baseUrl: string) {}

  static fromStateDir(stateDir?: string): DaemonControlClient | null {
    const dir = stateDir ?? join(process.cwd(), ".kota");
    const address = readOptionalJsonFile<DaemonControlAddress>(join(dir, "daemon-control.json"));
    if (!address || typeof address.port !== "number") return null;
    return new DaemonControlClient(`http://127.0.0.1:${address.port}`);
  }

  async getDaemonStatus(): Promise<DaemonLiveStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/status`);
      if (!res.ok) return null;
      return (await res.json()) as DaemonLiveStatus;
    } catch {
      return null;
    }
  }

  async getWorkflowStatus(): Promise<WorkflowLiveStatus | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/status`);
      if (!res.ok) return null;
      return (await res.json()) as WorkflowLiveStatus;
    } catch {
      return null;
    }
  }

  async pause(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/pause`, { method: "POST" });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; paused: boolean; already?: boolean };
    } catch {
      return null;
    }
  }

  async resume(): Promise<{ ok: boolean; paused: boolean; already?: boolean } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/resume`, { method: "POST" });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; paused: boolean; already?: boolean };
    } catch {
      return null;
    }
  }

  async abort(): Promise<{ ok: boolean; aborted: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/abort`, { method: "POST" });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; aborted: number };
    } catch {
      return null;
    }
  }

  async reload(): Promise<{ ok: boolean; count: number } | null> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workflow/reload`, { method: "POST" });
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 409) return { ok: false, alreadyQueued: true };
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; queued?: string };
    } catch {
      return null;
    }
  }

  async *events(): AsyncGenerator<DaemonSseEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/events`);
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
