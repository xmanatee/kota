// `GET /api/digest` mobile seam. The shared conformance decoder under
// `./conformance/decoders` mirrors the daemon's `DailyDigestData` shape
// exported from `src/modules/autonomy/workflows/daily-digest/aggregate.ts`
// and matches the macOS Swift `Codable` decoder's strict posture: a
// daemon-shipped malformed payload (missing required field, drifted
// discriminator) throws a `ContractDecodeError` at the mobile boundary
// instead of flowing into `DigestScreen` as a typed-but-invalid object.

import {
  parseDigestResponse,
  type DigestResponse,
} from './conformance/decoders';
import { daemonRequest, type DaemonHttp } from './http';

export type {
  DigestData,
  DigestQueueCounts,
  DigestQueueDelta,
  DigestResponse,
} from './conformance/decoders';

export async function getDigest(http: DaemonHttp): Promise<DigestResponse> {
  const raw = await daemonRequest<unknown>(http, '/api/digest');
  return parseDigestResponse(raw);
}
