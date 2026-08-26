import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { Scheduler } from "#core/daemon/scheduler.js";
import type { DirectoryScope } from "#core/daemon/scope-registry.js";
import type { ScopeRuntime } from "#core/daemon/scope-runtime.js";
import { createKotaClientTestDouble } from "#core/server/daemon-client-test-support.js";
import { daemonTransportFromAddress } from "#core/server/daemon-transport.js";
import { createScopedKotaClient } from "#core/server/scoped-kota-client.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

export const SCOPE_A: DirectoryScope = {
  scopeId: "scope-a",
  scopeRoot: "/tmp/scope-a",
  displayName: "Scope A",
};

export const SCOPE_B: DirectoryScope = {
  scopeId: "scope-b",
  scopeRoot: "/tmp/scope-b",
  displayName: "Scope B",
};

export function makeScopeRuntime(
  scope: DirectoryScope,
): ScopeRuntime {
  return {
    scope,
    scheduler: new Scheduler(scope.scopeRoot, null),
  } as unknown as ScopeRuntime;
}

export function readControlAddress(
  stateDir: string,
): DaemonControlAddress {
  return JSON.parse(
    readFileSync(join(stateDir, "daemon-control.json"), "utf-8"),
  ) as DaemonControlAddress;
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
    });
    req.on("error", reject);
  });
}

export type RoutedCall = {
  kind: "memory" | "capture" | "retract";
  scopeId: string;
  query?: string;
  text?: string;
  id?: string;
};

export function makeScopedRoutes(
  calls: RoutedCall[],
  defaultScope: DirectoryScope = SCOPE_A,
) {
  return [
    {
      method: "GET" as const,
      path: "/api/memory/search",
      handler(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const scopeId =
          url.searchParams.get("scopeId") ?? defaultScope.scopeId;
        const query = url.searchParams.get("q") ?? "";
        calls.push({ kind: "memory", scopeId, query });
        const entries =
          scopeId === defaultScope.scopeId && query.includes("alpha")
            ? [
                {
                  id: "mem-a",
                  created: "2026-05-14T00:00:00.000Z",
                  content: "alpha lives only in scope A",
                },
              ]
            : [];
        writeJson(res, 200, { ok: true, entries });
      },
    },
    {
      method: "POST" as const,
      path: "/capture",
      async handler(req: IncomingMessage, res: ServerResponse) {
        const body = await readJsonBody(req);
        const filter = body.filter as
          | { scopeId?: string; target?: "memory" }
          | undefined;
        const scopeId = filter?.scopeId ?? defaultScope.scopeId;
        calls.push({
          kind: "capture",
          scopeId,
          text: typeof body.text === "string" ? body.text : "",
        });
        writeJson(res, 200, {
          ok: true,
          record: { target: "memory", recordId: `${scopeId}-capture` },
        });
      },
    },
    {
      method: "POST" as const,
      path: "/retract",
      async handler(req: IncomingMessage, res: ServerResponse) {
        const body = await readJsonBody(req);
        const scopeId =
          typeof body.scopeId === "string"
            ? body.scopeId
            : defaultScope.scopeId;
        calls.push({
          kind: "retract",
          scopeId,
          id: typeof body.id === "string" ? body.id : "",
        });
        writeJson(res, 200, {
          ok: true,
          record: {
            target: "memory",
            recordId: typeof body.id === "string" ? body.id : "unknown",
          },
        });
      },
    },
  ];
}

export function buildDaemonScopeClient(
  address: DaemonControlAddress,
): KotaClient {
  const transport = daemonTransportFromAddress(address);
  let client: KotaClient;
  client = createKotaClientTestDouble({
    scopes: {
      list: async () => {
        const raw = await transport.requestStrict<{
          scopes: DirectoryScope[];
          defaultScopeId: string;
          activeScopeId: string | null;
        }>("GET", "/scopes");
        return { ok: true as const, ...raw };
      },
      use: async (scopeId: string | null) => {
        const raw = await transport.requestStrict<{
          activeScopeId: string | null;
        }>("PATCH", "/scopes/active", { scopeId });
        return { ok: true as const, activeScopeId: raw.activeScopeId };
      },
    },
    memory: {
      search: async (query, filter) => {
        const params = new URLSearchParams();
        params.set("q", query);
        if (filter?.semantic) params.set("semantic", "true");
        if (filter?.limit !== undefined) {
          params.set("limit", String(filter.limit));
        }
        if (filter?.scopeId) params.set("scopeId", filter.scopeId);
        return transport.requestStrict(
          "GET",
          `/api/memory/search?${params.toString()}`,
        ) as ReturnType<KotaClient["memory"]["search"]>;
      },
    },
    capture: {
      capture: async (text, filter) =>
        transport.requestStrict("POST", "/capture", {
          text,
          ...(filter ? { filter } : {}),
        }) as ReturnType<KotaClient["capture"]["capture"]>,
    },
    retract: {
      retract: async (request) =>
        transport.requestStrict(
          "POST",
          "/retract",
          request,
        ) as ReturnType<KotaClient["retract"]["retract"]>,
    },
  }, (scopeId: string) => createScopedKotaClient(client, scopeId));
  return client;
}
