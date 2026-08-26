import {
  parseCaptureResult,
  type CaptureResult,
  type CaptureTarget,
} from './daemon-contract.generated';
import { daemonRequest, type DaemonHttp } from './http';

export type { CaptureRecord, CaptureResult, CaptureTarget } from './daemon-contract.generated';
export { parseCaptureResult } from './daemon-contract.generated';

export type CaptureFilter = { target?: CaptureTarget; hint?: string };
export const CAPTURE_TARGET_ORDER: ReadonlyArray<CaptureTarget> = [
  'memory', 'knowledge', 'tasks', 'inbox',
] as const;

export async function capture(
  http: DaemonHttp,
  text: string,
  options: CaptureFilter = {},
): Promise<CaptureResult> {
  const body: Record<string, unknown> = { text };
  if (Object.keys(options).length > 0) body.filter = options;
  return parseCaptureResult(await daemonRequest<unknown>(http, '/api/capture', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}
