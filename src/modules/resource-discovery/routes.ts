import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ControlRouteRegistration,
  RouteRegistration,
} from "#core/modules/module-types.js";
import { selectedScopeSelectorIdOrErrorResponse } from "#core/server/scope-selector-request.js";
import { jsonResponse, readBody } from "#core/server/session-pool.js";
import {
  RESOURCE_DISCOVERY_KINDS,
  type ResourceDiscoveryFilter,
  type ResourceDiscoveryKind,
  type ResourceDiscoveryProvider,
} from "./client.js";

type JsonBody = Awaited<ReturnType<typeof readBody>>;

function parseKinds(value: readonly string[]): ResourceDiscoveryKind[] {
  return value.filter((item): item is ResourceDiscoveryKind =>
    RESOURCE_DISCOVERY_KINDS.includes(item as ResourceDiscoveryKind)
  );
}

function parseFilter(value: JsonBody[keyof JsonBody]): ResourceDiscoveryFilter | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as {
    limit?: number;
    minScore?: number;
    includeUnavailable?: boolean;
    kinds?: string[];
    scopeId?: string;
  };
  const filter: ResourceDiscoveryFilter = {};
  if (typeof raw.limit === "number" && Number.isFinite(raw.limit)) {
    filter.limit = raw.limit;
  }
  if (typeof raw.minScore === "number" && Number.isFinite(raw.minScore)) {
    filter.minScore = raw.minScore;
  }
  if (typeof raw.includeUnavailable === "boolean") {
    filter.includeUnavailable = raw.includeUnavailable;
  }
  if (Array.isArray(raw.kinds)) {
    const kinds = parseKinds(raw.kinds);
    if (kinds.length > 0) filter.kinds = kinds;
  }
  if (typeof raw.scopeId === "string" && raw.scopeId.trim() !== "") {
    filter.scopeId = raw.scopeId;
  }
  return filter;
}

export function createResourceDiscoveryRouteHandler(
  resolveProvider: () => ResourceDiscoveryProvider,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async function handler(req, res): Promise<void> {
    let body: JsonBody;
    try {
      body = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Invalid request body" });
      return;
    }
    const query = typeof body.query === "string" ? body.query : "";
    if (query.trim() === "") {
      jsonResponse(res, 400, { error: "query is required" });
      return;
    }
    const filter = parseFilter(body.filter);
    if (selectedScopeSelectorIdOrErrorResponse(res, filter) === null) return;
    try {
      jsonResponse(res, 200, await resolveProvider().discover(query, filter));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jsonResponse(res, 500, { error: message });
    }
  };
}

export function resourceDiscoveryControlRoutes(
  resolveProvider: () => ResourceDiscoveryProvider,
): ControlRouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/resource-discovery",
      capabilityScope: "read",
      handler: createResourceDiscoveryRouteHandler(resolveProvider),
    },
  ];
}

export function resourceDiscoveryApiRoutes(
  resolveProvider: () => ResourceDiscoveryProvider,
): RouteRegistration[] {
  return [
    {
      method: "POST",
      path: "/api/resource-discovery",
      handler: createResourceDiscoveryRouteHandler(resolveProvider),
    },
  ];
}
