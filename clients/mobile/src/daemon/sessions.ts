import { daemonResponse, type DaemonHttp } from './http';

export async function deleteSession(
  http: DaemonHttp,
  id: string,
): Promise<void> {
  const response = await daemonResponse(
    http,
    `/sessions/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
}

export function chatUrl(http: DaemonHttp, sessionId: string): string {
  return `${http.baseUrl}/sessions/${encodeURIComponent(sessionId)}/chat`;
}

export function sseUrl(http: DaemonHttp, since?: string): string {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return `${http.baseUrl}/events${query}`;
}
