// Mirror of the daemon's on-demand attention envelope exported from
// `src/modules/autonomy/workflows/attention-digest/step.ts`. The same
// shape backs the Telegram `/attention`, `kota attention` CLI, daemon
// HTTP `GET /api/attention`, embedded web `AttentionPanel`, and macOS
// `AttentionView` surfaces; the mobile AttentionScreen is the seventh.

import { daemonRequest, type DaemonHttp } from './http';

export interface AttentionItem {
  label: string;
  detail: string;
}

export interface AttentionResponse {
  data: { items: AttentionItem[] };
  text: string;
}

export function getAttention(http: DaemonHttp): Promise<AttentionResponse> {
  return daemonRequest<AttentionResponse>(http, '/api/attention');
}
