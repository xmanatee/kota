import type { IncomingMessage, ServerResponse } from "node:http";
import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import { jsonResponse, readBody } from "./daemon-control-utils.js";

export function handleListSessions(handle: DaemonControlHandle, res: ServerResponse): void {
  jsonResponse(res, 200, { sessions: handle.listSessions() });
}

export function handleRegisterSession(
  handle: DaemonControlHandle,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  readBody(req)
    .then((buf) => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(buf.toString()) as Record<string, unknown>;
      } catch {
        jsonResponse(res, 400, { error: "Invalid JSON body" });
        return;
      }
      const id = body.id;
      const createdAt = body.createdAt;
      const autonomyMode = body.autonomyMode;
      if (!id || typeof id !== "string" || !createdAt || typeof createdAt !== "string") {
        jsonResponse(res, 400, { error: "id and createdAt are required strings" });
        return;
      }
      if (!isAutonomyMode(autonomyMode)) {
        jsonResponse(res, 400, { error: "autonomyMode is required (passive, supervised, autonomous)" });
        return;
      }
      handle.registerSession(id, createdAt, autonomyMode);
      jsonResponse(res, 200, { ok: true });
    })
    .catch(() => jsonResponse(res, 500, { error: "Internal error" }));
}

export function handleUnregisterSession(
  handle: DaemonControlHandle,
  res: ServerResponse,
  params: Record<string, string>,
): void {
  handle.unregisterSession(params.id);
  res.writeHead(204);
  res.end();
}
