import type { ResourceFailure } from '../../shared/resource-state';

export function classifyDaemonResourceFailure(
  error: unknown,
): ResourceFailure<string> {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof TypeError
    ? { status: 'offline', error: message }
    : { status: 'recoverable-failure', error: message };
}
