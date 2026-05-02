// Interactive session shapes (creation, autonomy mode, chat stream).

import { daemonRequest, type DaemonHttp } from './http';

export type AutonomyMode = 'passive' | 'supervised' | 'autonomous';

export interface InteractiveSession {
  id: string;
  createdAt: string;
  lastActive: number;
  autonomyMode: AutonomyMode;
  source?: 'daemon' | 'serve';
  busy?: boolean;
}

export interface SetAutonomyModeResponse {
  session_id: string;
  autonomy_mode: AutonomyMode;
  source?: string;
  serveOwned?: boolean;
}

export type ChatStreamEventType =
  | 'session'
  | 'text'
  | 'thinking'
  | 'thinking_start'
  | 'progress'
  | 'status'
  | 'cost'
  | 'error'
  | 'notification'
  | 'guardrail'
  | 'tool_metric'
  | 'state_change'
  | 'done';

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  payload: Record<string, unknown>;
}

export function getSessions(
  http: DaemonHttp,
): Promise<{ sessions: InteractiveSession[] }> {
  return daemonRequest<{ sessions: InteractiveSession[] }>(http, '/sessions');
}

export function createSession(
  http: DaemonHttp,
  autonomyMode?: AutonomyMode,
): Promise<{ session_id: string; autonomy_mode?: AutonomyMode }> {
  return daemonRequest<{ session_id: string; autonomy_mode?: AutonomyMode }>(
    http,
    '/sessions',
    {
      method: 'POST',
      body: JSON.stringify(autonomyMode ? { autonomy_mode: autonomyMode } : {}),
    },
  );
}

export function setSessionAutonomyMode(
  http: DaemonHttp,
  id: string,
  mode: AutonomyMode,
): Promise<SetAutonomyModeResponse> {
  return daemonRequest<SetAutonomyModeResponse>(
    http,
    `/sessions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ autonomy_mode: mode }),
    },
  );
}

// `DELETE /sessions/:id` tolerates 404 — a missing session is the same
// outcome as a successful deletion. Any other non-2xx surface throws.
export async function deleteSession(
  http: DaemonHttp,
  id: string,
): Promise<void> {
  const url = `${http.baseUrl}/sessions/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${http.token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
}

// Returns the chat streaming URL for `POST /sessions/:id/chat`.
export function chatUrl(http: DaemonHttp, sessionId: string): string {
  return `${http.baseUrl}/sessions/${encodeURIComponent(sessionId)}/chat`;
}

// Returns the SSE endpoint URL.
export function sseUrl(http: DaemonHttp, since?: string): string {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  return `${http.baseUrl}/events${params}`;
}
