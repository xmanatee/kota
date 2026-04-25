/**
 * Daemon-control route contribution for the push-notification module.
 *
 * Exposes `POST /push-tokens` with `control` capability scope. The wire
 * contract — JSON body `{ token, deviceId }`, `400 { error: "Invalid JSON
 * body" }` on parse failure, `400 { error: "token and deviceId are
 * required" }` on missing fields, `200 { ok: true }` on success — is the
 * same contract the mobile-client `DaemonControlClient.registerPushToken`
 * expects.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import { registerPushToken } from "./store.js";

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function handleRegisterPushToken(
  projectDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readBody(req);
  } catch {
    jsonResponse(res, 500, { error: "Internal error" });
    return;
  }

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

  registerPushToken(projectDir, deviceId, token);
  jsonResponse(res, 200, { ok: true });
}

export function pushNotificationControlRoutes(
  projectDir: string,
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/push-tokens",
      capabilityScope: "control",
      handler: (req, res) => handleRegisterPushToken(projectDir, req, res),
    },
  ];
}
