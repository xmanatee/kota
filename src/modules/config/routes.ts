import type { ServerResponse } from "node:http";
import type { KotaConfig } from "#core/config/config.js";
import { maskConfig } from "#core/config/config-redaction.js";
import { jsonResponse } from "#core/server/session-pool.js";

export type ConfigResponse = {
  config: unknown;
};

export { maskConfig } from "#core/config/config-redaction.js";

export function handleGetConfig(res: ServerResponse, config: KotaConfig): void {
  jsonResponse(res, 200, { config: maskConfig(config) } satisfies ConfigResponse);
}
