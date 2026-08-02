import type { EventJournalQuery } from "#core/events/event-journal.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import type { ControlRouteRegistration } from "#core/modules/module-types.js";
import type { BuiltinControlRouteDeps } from "./daemon-control-routes.js";
import type { EventSchemaDetail, EventSchemaSummary } from "./daemon-control-types.js";
import { jsonResponse } from "./daemon-control-utils.js";

function eventTypeMatchesGlob(eventType: string, glob: string): boolean {
  const segments = glob.split("*");
  const prefix = segments[0] ?? "";
  if (prefix !== "" && !eventType.startsWith(prefix)) return false;

  let offset = prefix.length;
  const suffix = segments[segments.length - 1] ?? "";
  for (let index = 1; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (segment === "") continue;
    const foundAt = eventType.indexOf(segment, offset);
    if (foundAt === -1) return false;
    offset = foundAt + segment.length;
  }
  if (suffix === "") return true;
  const suffixStart = eventType.length - suffix.length;
  return suffixStart >= offset && eventType.endsWith(suffix);
}

function parseEventJournalQuery(url: URL): EventJournalQuery {
  const sinceParam = url.searchParams.get("since");
  const sinceMs = sinceParam ? new Date(sinceParam).getTime() : undefined;
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const typeParam = url.searchParams.get("type");
  const idParam = url.searchParams.get("id");
  const scopeIdParam = url.searchParams.get("scopeId") ?? url.searchParams.get("projectId");
  const sourceIdParam = url.searchParams.get("sourceId");
  return {
    ...(idParam ? { id: idParam } : {}),
    ...(typeParam
      ? typeParam.includes("*")
        ? { typeGlob: typeParam }
        : { typePrefix: typeParam }
      : {}),
    ...(scopeIdParam ? { scopeId: scopeIdParam } : {}),
    ...(sourceIdParam ? { sourceId: sourceIdParam } : {}),
    ...(sinceMs !== undefined && !Number.isNaN(sinceMs) ? { sinceMs } : {}),
    ...(url.searchParams.get("after") ? { after: url.searchParams.get("after")! } : {}),
    ...(parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
      ? { limit: parsedLimit }
      : {}),
  };
}

function listEventSchemaDetails(): EventSchemaDetail[] {
  const registry = getModuleEventRegistry();
  if (!registry) return [];
  return [...registry.all().values()]
    .map((registration): EventSchemaDetail => ({
      name: registration.name,
      module: registration.module,
      scope: registration.scope,
      currentVersion: registration.currentVersion,
      fields: registration.fields,
      filterablePaths: registration.filterablePaths,
      sensitivity: registration.sensitivity,
      compatibility: registration.compatibility,
      workflowTriggerPolicy: registration.workflowTriggerPolicy,
      payloadSchema: registration.payloadSchema,
      examples: registration.examples,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function eventSchemaSummary(detail: EventSchemaDetail): EventSchemaSummary {
  return {
    name: detail.name,
    module: detail.module,
    scope: detail.scope,
    currentVersion: detail.currentVersion,
    fields: detail.fields,
    filterablePaths: detail.filterablePaths,
    sensitivity: detail.sensitivity,
    compatibility: detail.compatibility,
    workflowTriggerPolicy: detail.workflowTriggerPolicy,
  };
}

export function buildDaemonEventControlRoutes(
  deps: BuiltinControlRouteDeps,
): ControlRouteRegistration[] {
  const { eventBuffer, eventJournal, sseClients } = deps;
  return [
    {
      method: "GET",
      path: "/event-schemas",
      capabilityScope: "read",
      handler: (_req, res) => jsonResponse(res, 200, {
        events: listEventSchemaDetails().map(eventSchemaSummary),
      }),
    },
    {
      method: "GET",
      path: "/event-schemas/:name",
      capabilityScope: "read",
      handler: (_req, res, params) => {
        const detail = listEventSchemaDetails().find((candidate) => candidate.name === params.name);
        if (!detail) {
          jsonResponse(res, 404, {
            error: "Unknown event schema",
            reason: "unknown_event_schema",
            event: params.name,
          });
          return;
        }
        jsonResponse(res, 200, detail);
      },
    },
    {
      method: "GET",
      path: "/events",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(":\n\n");
        const sinceParam = url.searchParams.get("since");
        const afterParam = url.searchParams.get("after") ?? req.headers["last-event-id"];
        if (sinceParam) {
          const sinceMs = new Date(sinceParam).getTime();
          if (!Number.isNaN(sinceMs)) {
            const afterId = typeof afterParam === "string" ? afterParam : undefined;
            for (const entry of eventBuffer.query(sinceMs, undefined, afterId)) {
              res.write(`id: ${entry.id}\nevent: ${entry.event.type}\ndata: ${JSON.stringify(entry.event.payload)}\n\n`);
            }
          }
        } else {
          const afterId = typeof afterParam === "string" ? afterParam : undefined;
          if (afterId) {
            for (const entry of eventBuffer.query(undefined, undefined, afterId)) {
              res.write(`id: ${entry.id}\nevent: ${entry.event.type}\ndata: ${JSON.stringify(entry.event.payload)}\n\n`);
            }
          }
        }
        sseClients.add(res);
        req.on("close", () => { sseClients.delete(res); });
      },
    },
    {
      method: "GET",
      path: "/api/events",
      capabilityScope: "read",
      handler: (req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (eventJournal) {
          const entries = eventJournal.query(parseEventJournalQuery(url));
          jsonResponse(res, 200, {
            events: entries.map((entry) => eventJournal.toClientProjection(entry)),
          });
          return;
        }
        const sinceParam = url.searchParams.get("since");
        const afterParam = url.searchParams.get("after");
        const limitParam = url.searchParams.get("limit");
        const typeParam = url.searchParams.get("type");
        const sinceMs = sinceParam ? new Date(sinceParam).getTime() : undefined;
        const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
        let entries = eventBuffer.query(
          sinceMs != null && !Number.isNaN(sinceMs) ? sinceMs : undefined,
          limit == null || typeParam != null ? undefined : limit,
          afterParam ?? undefined,
        );
        if (typeParam) {
          entries = typeParam.includes("*")
            ? entries.filter(({ event }) => eventTypeMatchesGlob(event.type, typeParam))
            : entries.filter(({ event }) => event.type.startsWith(typeParam));
          if (limit != null && entries.length > limit) {
            entries = entries.slice(entries.length - limit);
          }
        }
        jsonResponse(res, 200, {
          events: entries.map(({ id, event, timestamp }) => ({
            id,
            type: event.type,
            payload: event.payload,
            timestamp: new Date(timestamp).toISOString(),
          })),
        });
      },
    },
  ];
}
