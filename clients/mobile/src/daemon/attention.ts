import {
  parseAttentionResponse,
  type AttentionResponse,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { AttentionItem, AttentionResponse } from './daemon-contract.generated';

export async function getAttention(http: DaemonHttp): Promise<AttentionResponse> {
  return parseAttentionResponse(await daemonRequest<unknown>(http, '/api/attention'));
}
