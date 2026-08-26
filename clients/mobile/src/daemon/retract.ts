import {
  parseRetractResult,
  type RetractResult,
  type RetractTarget,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { RetractRecord, RetractResult, RetractTarget } from './daemon-contract.generated';
export { parseRetractResult } from './daemon-contract.generated';

export type RetractRequest =
  | { target: 'memory'; id: string }
  | { target: 'knowledge'; slug: string }
  | { target: 'tasks'; id: string }
  | { target: 'inbox'; path: string };
export const RETRACT_TARGET_ORDER: ReadonlyArray<RetractTarget> = [
  'memory', 'knowledge', 'tasks', 'inbox',
] as const;

export async function retract(
  http: DaemonHttp,
  request: RetractRequest,
): Promise<RetractResult> {
  return parseRetractResult(await daemonRequest<unknown>(http, '/api/retract', {
    method: 'POST',
    body: JSON.stringify(request),
  }));
}
