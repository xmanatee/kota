import { parseDaemonClientErrorBody } from "#core/daemon/client-error.js";

export async function daemonResponseError(response: Response): Promise<Error> {
  const body = parseDaemonClientErrorBody(await response.text());
  if (body?.error !== undefined) return new Error(body.error);
  return new Error(`HTTP ${response.status}`);
}
