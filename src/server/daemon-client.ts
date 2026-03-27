import { join } from "node:path";
import { readOptionalJsonFile } from "../json-file.js";
import type {
  DaemonControlAddress,
  DaemonLiveStatus,
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
}
