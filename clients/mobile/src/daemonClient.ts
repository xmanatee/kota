import type {
  Approval,
  DaemonStatus,
  HealthResponse,
  RunDetail,
  RunSummary,
  TasksResponse,
} from './types';

export class DaemonClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  health(): Promise<HealthResponse> {
    return fetch(`${this.baseUrl}/health`).then((r) => r.json());
  }

  getStatus(): Promise<DaemonStatus> {
    return this.request<DaemonStatus>('/status');
  }

  getRuns(workflow?: string, limit = 20): Promise<{ runs: RunSummary[] }> {
    const params = new URLSearchParams();
    if (workflow) params.set('workflow', workflow);
    params.set('limit', String(limit));
    return this.request<{ runs: RunSummary[] }>(`/workflow/runs?${params}`);
  }

  getRunDetail(id: string): Promise<RunDetail> {
    return this.request<RunDetail>(`/workflow/runs/${encodeURIComponent(id)}`);
  }

  getApprovals(): Promise<{ approvals: Approval[] }> {
    return this.request<{ approvals: Approval[] }>('/approvals');
  }

  approve(id: string, note?: string): Promise<{ approval: Approval }> {
    return this.request<{ approval: Approval }>(
      `/approvals/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: note !== undefined ? JSON.stringify({ note }) : undefined,
      },
    );
  }

  reject(id: string, reason?: string): Promise<{ approval: Approval }> {
    return this.request<{ approval: Approval }>(
      `/approvals/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
      },
    );
  }

  getTasks(): Promise<TasksResponse> {
    return this.request<TasksResponse>('/tasks');
  }

  registerPushToken(deviceId: string, token: string): Promise<{ ok: boolean }> {
    return this.request('/push-tokens', {
      method: 'POST',
      body: JSON.stringify({ deviceId, token }),
    });
  }

  pauseDispatch(): Promise<{ ok: boolean; paused: boolean }> {
    return this.request('/workflow/pause', { method: 'POST' });
  }

  resumeDispatch(): Promise<{ ok: boolean; paused: boolean }> {
    return this.request('/workflow/resume', { method: 'POST' });
  }

  /** Returns the SSE endpoint URL (used by useSSE hook). */
  sseUrl(since?: string): string {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return `${this.baseUrl}/events${params}`;
  }

  get authHeader(): string {
    return `Bearer ${this.token}`;
  }
}
