/**
 * Integration test: a running Daemon must serve module-contributed HTTP
 * routes (`KotaModule.routes`) through its control server, not just its
 * built-in and contributed control routes. The CLI's `KotaClient` talks to
 * those `/api/*` routes, so a daemon that registers them as 404 silently
 * breaks every operator subcommand the moment a daemon is running.
 *
 * Failure mode this test is designed to catch:
 *   `pnpm kota daemon-ops start` followed by `kota task list`, `kota
 *   secrets list`, `kota module list`, etc. all return `Fatal: Not found`
 *   because the daemon control server registers `controlRoutes` only.
 *
 * The test boots a real Daemon, contributes module routes through the
 * production seam (`DaemonConfig.routes`), and asserts at least three
 * representative `/api/*` routes from distinct modules respond 2xx for a
 * valid bearer-authenticated request.
 */

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import type { RouteRegistration } from "#core/modules/module-types.js";
import { handleListModules } from "#modules/module-manager/routes.js";
import { taskRoutes } from "#modules/repo-tasks/routes.js";
import { secretsRoutes } from "#modules/secrets/routes.js";

function readControlAddress(stateDir: string): DaemonControlAddress {
  const raw = readFileSync(join(stateDir, "daemon-control.json"), "utf-8");
  return JSON.parse(raw) as DaemonControlAddress;
}

async function fetchWithToken(
  port: number,
  path: string,
  token: string,
): Promise<Response> {
  return globalThis.fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("Daemon module HTTP routes integration", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-daemon-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(projectDir, ".kota");
    mkdirSync(stateDir, { recursive: true });
    resetEventBus();
    resetScheduler();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("serves module-contributed /api/* routes from at least three modules", async () => {
    const moduleRoutes: RouteRegistration[] = [
      ...taskRoutes(),
      ...secretsRoutes(),
      {
        method: "GET",
        path: "/api/modules",
        handler: (_req, res) =>
          handleListModules(res, [
            {
              name: "repo-tasks",
              source: "project",
              version: "1.0.0",
              description: "tasks",
              dependencies: [],
              toolNames: [],
              workflowNames: [],
              channelNames: [],
              skillNames: [],
              agentNames: [],
              agents: [],
              skills: [],
              commandNames: ["task"],
              routeSummaries: [],
            },
            {
              name: "secrets",
              source: "project",
              version: "1.0.0",
              description: "secrets",
              dependencies: [],
              toolNames: [],
              workflowNames: [],
              channelNames: [],
              skillNames: [],
              agentNames: [],
              agents: [],
              skills: [],
              commandNames: ["secrets"],
              routeSummaries: [],
            },
          ]),
      },
    ];

    const daemon = new Daemon({
      projectDir,
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      routes: moduleRoutes,
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const startPromise = daemon.start();
    try {
      // Wait for control file to appear.
      await new Promise((resolve) => setTimeout(resolve, 60));
      const address = readControlAddress(stateDir);
      const port = address.port;
      const token = address.token!;

      const tasksRes = await fetchWithToken(port, "/api/tasks", token);
      expect(tasksRes.status).toBe(200);
      const tasksBody = (await tasksRes.json()) as Record<string, unknown>;
      expect(tasksBody).toHaveProperty("counts");
      expect(tasksBody).toHaveProperty("tasks");

      const secretsRes = await fetchWithToken(port, "/api/secrets", token);
      expect(secretsRes.status).toBe(200);
      const secretsBody = (await secretsRes.json()) as { secrets: unknown[] };
      expect(Array.isArray(secretsBody.secrets)).toBe(true);

      const modulesRes = await fetchWithToken(port, "/api/modules", token);
      expect(modulesRes.status).toBe(200);
      const modulesBody = (await modulesRes.json()) as { modules: unknown[] };
      expect(Array.isArray(modulesBody.modules)).toBe(true);
      expect(modulesBody.modules.length).toBeGreaterThanOrEqual(2);
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

  it("rejects unauthenticated module-route requests", async () => {
    const daemon = new Daemon({
      projectDir,
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      workflows: [],
      routes: secretsRoutes(),
      config: { defaultAgentHarness: "claude-agent-sdk" },
    });

    const startPromise = daemon.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const address = readControlAddress(stateDir);
      const res = await globalThis.fetch(
        `http://127.0.0.1:${address.port}/api/secrets`,
      );
      expect(res.status).toBe(401);
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });
});
