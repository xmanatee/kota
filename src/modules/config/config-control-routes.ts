/**
 * Daemon-control HTTP routes for the `config` namespace.
 *
 * Both the daemon-control server and the local-side handler reach the
 * same `validateConfig` / `getConfigValue` / `setConfigValue` helpers so
 * daemon-up and daemon-down callers see the same shape and the same
 * `.kota/config.json` mutation.
 */
import type { IncomingMessage } from "node:http";
import type {
  ControlRouteRegistration,
  ModuleContext,
} from "#core/modules/module-types.js";
import { jsonResponse } from "#core/server/session-pool.js";
import {
  configSchemaContent,
  configSchemaPath,
  getConfigValue,
  setConfigValue,
  validateConfig,
} from "./config-operations.js";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) return {};
  return JSON.parse(text);
}

export function configControlRoutes(ctx: ModuleContext): ControlRouteRegistration[] {
  return [
    {
      method: "GET",
      path: "/config/validate",
      capabilityScope: "read",
      handler: (_req, res) => {
        const result = validateConfig(ctx.cwd, ctx.getRegisteredConfigKeys());
        jsonResponse(res, 200, result);
      },
    },
    {
      method: "GET",
      path: "/config/value",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const key = url.searchParams.get("key");
        if (!key) {
          jsonResponse(res, 400, { error: "missing 'key' query parameter" });
          return;
        }
        const result = getConfigValue(ctx.cwd, key);
        if (!result.found) {
          jsonResponse(res, 404, { found: false, reason: "not_found" });
          return;
        }
        jsonResponse(res, 200, result);
      },
    },
    {
      method: "PUT",
      path: "/config/value",
      capabilityScope: "control",
      handler: async (req, res) => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          jsonResponse(res, 400, { error: (err as Error).message });
          return;
        }
        const obj = body as { key?: unknown; rawValue?: unknown };
        if (typeof obj.key !== "string" || typeof obj.rawValue !== "string") {
          jsonResponse(res, 400, { error: "body must include string 'key' and string 'rawValue'" });
          return;
        }
        const result = setConfigValue(
          ctx.cwd,
          ctx.getRegisteredConfigKeys(),
          obj.key,
          obj.rawValue,
        );
        jsonResponse(res, 200, result);
      },
    },
    {
      method: "GET",
      path: "/config/schema-path",
      capabilityScope: "read",
      handler: (_req, res) => {
        jsonResponse(res, 200, { path: configSchemaPath() });
      },
    },
    {
      method: "GET",
      path: "/config/schema",
      capabilityScope: "read",
      handler: (_req, res) => {
        jsonResponse(res, 200, { content: configSchemaContent() });
      },
    },
  ];
}
