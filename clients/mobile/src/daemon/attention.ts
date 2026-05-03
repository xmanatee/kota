// `GET /api/attention` mobile seam. The shared conformance decoder under
// `./conformance/decoders` matches the daemon's on-demand attention envelope
// exported from `src/modules/autonomy/workflows/attention-digest/step.ts`,
// the macOS Swift `Codable` decoder, and the mobile per-store search seams'
// strict posture: a daemon-shipped malformed payload throws a
// `ContractDecodeError` at the mobile boundary instead of flowing into
// `AttentionScreen` as a typed-but-invalid object.

import {
  parseAttentionResponse,
  type AttentionResponse,
} from './conformance/decoders';
import { daemonRequest, type DaemonHttp } from './http';

export type { AttentionItem, AttentionResponse } from './conformance/decoders';

export async function getAttention(
  http: DaemonHttp,
): Promise<AttentionResponse> {
  const raw = await daemonRequest<unknown>(http, '/api/attention');
  return parseAttentionResponse(raw);
}
