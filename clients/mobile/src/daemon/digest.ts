import {
  parseDigestResponse,
  type DigestResponse,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type {
  DigestData,
  DigestQueueCounts,
  DigestQueueDelta,
  DigestResponse,
} from './daemon-contract.generated';

export async function getDigest(http: DaemonHttp): Promise<DigestResponse> {
  return parseDigestResponse(await daemonRequest<unknown>(http, '/api/digest'));
}
