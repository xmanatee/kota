import type { IncomingMessage, ServerResponse } from "node:http";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

export function handleRegisterPushToken(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  readBody(req)
    .then((buf) => {
      let token: string | undefined;
      let deviceId: string | undefined;
      try {
        const body = JSON.parse(buf.toString()) as Record<string, unknown>;
        token = typeof body.token === "string" ? body.token : undefined;
        deviceId = typeof body.deviceId === "string" ? body.deviceId : undefined;
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON body" });
        return;
      }
      if (!token || !deviceId) {
        jsonResponse(res, 400, { error: "token and deviceId are required" });
        return;
      }
      handle.registerPushToken(deviceId, token);
      jsonResponse(res, 200, { ok: true });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}
