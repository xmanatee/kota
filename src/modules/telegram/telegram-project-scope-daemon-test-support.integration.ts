import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import { Scheduler } from "#core/daemon/scheduler.js";
import type { ConfiguredProject } from "#core/daemon/scope-registry.js";
import { buildMigratedNamespaceTestStubs } from "#core/server/daemon-client-test-stubs.js";
import { daemonTransportFromAddress } from "#core/server/daemon-transport.js";
import type { KotaClient } from "#core/server/kota-client.js";
import { createProjectScopedKotaClient } from "#core/server/project-scoped-kota-client.js";

export const PROJECT_A: ConfiguredProject = {
  projectId: "project-a",
  projectDir: "/tmp/project-a",
  displayName: "Project A",
};

export const PROJECT_B: ConfiguredProject = {
  projectId: "project-b",
  projectDir: "/tmp/project-b",
  displayName: "Project B",
};

export function makeProjectRuntime(
  project: ConfiguredProject,
): ProjectRuntime {
  return {
    project,
    scheduler: new Scheduler(project.projectDir, null),
  } as ProjectRuntime;
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
  projectId: string;
  query?: string;
  text?: string;
  id?: string;
};

export function makeProjectScopedRoutes(
  calls: RoutedCall[],
  defaultProject: ConfiguredProject = PROJECT_A,
) {
  return [
    {
      method: "GET" as const,
      path: "/api/memory/search",
      handler(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const projectId =
          url.searchParams.get("projectId") ?? defaultProject.projectId;
        const query = url.searchParams.get("q") ?? "";
        calls.push({ kind: "memory", projectId, query });
        const entries =
          projectId === defaultProject.projectId && query.includes("alpha")
            ? [
                {
                  id: "mem-a",
                  created: "2026-05-14T00:00:00.000Z",
                  content: "alpha lives only in project A",
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
          | { projectId?: string; target?: "memory" }
          | undefined;
        const projectId = filter?.projectId ?? defaultProject.projectId;
        calls.push({
          kind: "capture",
          projectId,
          text: typeof body.text === "string" ? body.text : "",
        });
        writeJson(res, 200, {
          ok: true,
          record: { target: "memory", recordId: `${projectId}-capture` },
        });
      },
    },
    {
      method: "POST" as const,
      path: "/retract",
      async handler(req: IncomingMessage, res: ServerResponse) {
        const body = await readJsonBody(req);
        const projectId =
          typeof body.projectId === "string"
            ? body.projectId
            : defaultProject.projectId;
        calls.push({
          kind: "retract",
          projectId,
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

export function buildDaemonProjectClient(
  address: DaemonControlAddress,
): KotaClient {
  const transport = daemonTransportFromAddress(address);
  const stubs = buildMigratedNamespaceTestStubs();
  let client: KotaClient;
  client = {
    ...stubs,
    forProject: (projectId: string) =>
      createProjectScopedKotaClient(client, projectId),
    projects: {
      list: async () => {
        const raw = await transport.requestStrict<{
          projects: ConfiguredProject[];
          defaultProjectId: string;
          activeProjectId: string | null;
        }>("GET", "/projects");
        return { ok: true as const, ...raw };
      },
      use: async (projectId: string | null) => {
        const raw = await transport.requestStrict<{
          activeProjectId: string | null;
        }>("PATCH", "/projects/active", { projectId });
        return { ok: true as const, activeProjectId: raw.activeProjectId };
      },
    },
    memory: {
      ...stubs.memory!,
      search: async (query, filter) => {
        const params = new URLSearchParams();
        params.set("q", query);
        if (filter?.semantic) params.set("semantic", "true");
        if (filter?.limit !== undefined) {
          params.set("limit", String(filter.limit));
        }
        if (filter?.projectId) params.set("projectId", filter.projectId);
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
  } as KotaClient;
  return client;
}
