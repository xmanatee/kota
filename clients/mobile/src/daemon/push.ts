// Push-notification token registration with the daemon's
// `/push-tokens` route.

import { daemonRequest, type DaemonHttp } from './http';

export function registerPushToken(
  http: DaemonHttp,
  deviceId: string,
  token: string,
): Promise<{ ok: boolean }> {
  return daemonRequest(http, '/push-tokens', {
    method: 'POST',
    body: JSON.stringify({ deviceId, token }),
  });
}
