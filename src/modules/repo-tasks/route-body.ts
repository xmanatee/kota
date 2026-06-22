import type { IncomingMessage, ServerResponse } from "node:http";
import { jsonResponse, readBody } from "#core/server/session-pool.js";

export async function readRouteJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    return await readBody(req);
  } catch {
    jsonResponse(res, 400, { error: "Invalid request body" });
    return null;
  }
}
