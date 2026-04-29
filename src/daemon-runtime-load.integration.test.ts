/**
 * Integration test: the daemon must drive a full module-load lifecycle
 * before serving provider-backed routes. The CLI bootstraps its
 * `ModuleLoader` in `"commands"` mode for cheap subcommand registration,
 * which intentionally skips every module's `onLoad` — including the
 * `registerProvider` calls that back `/api/knowledge`, `/api/memory`,
 * `/api/history`, `/recall`, `/answer`, etc.
 *
 * Failure mode this test pins down:
 *   `pnpm build && node dist/cli.js daemon` produced a daemon whose
 *   `/status` looked healthy while every provider-backed route returned a
 *   500 with "provider not registered". The runtime now uses
 *   `loadRuntimeModules` so the lifecycle and the served routes cannot
 *   diverge.
 *
 * The two cases below are the contract:
 *   - `loadRuntimeModules` registers provider-backed seams. A daemon built
 *     from its contributions serves `/api/knowledge` with 200.
 *   - A `"commands"` loader cannot hand back its routes at all: the typed
 *     accessor throws so a runtime host can never silently ship with a
 *     partial module lifecycle.
 */

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Daemon } from "#core/daemon/daemon.js";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { resetScheduler } from "#core/daemon/scheduler.js";
import { resetEventBus } from "#core/events/event-bus.js";
import { discoverModules } from "#core/modules/module-discovery.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { discoverProjectModules } from "#core/modules/project-discovery.js";
import {
  getKnowledgeProvider,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { loadRuntimeModules } from "#core/modules/runtime-loader.js";

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

describe("daemon runtime module load", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-runtime-load-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    stateDir = join(projectDir, ".kota");
    mkdirSync(stateDir, { recursive: true });
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
  });

  afterEach(() => {
    resetEventBus();
    resetScheduler();
    resetProviderRegistry();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("loadRuntimeModules registers provider-backed seams; daemon serves /api/knowledge", async () => {
    const config = { defaultAgentHarness: "claude-agent-sdk" };
    const loader = await loadRuntimeModules({ config, cwd: projectDir });

    expect(() => getKnowledgeProvider()).not.toThrow();

    const daemon = new Daemon({
      projectDir,
      stateDir,
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
      // Keep workflows/channels off the daemon so the test is bounded by
      // route serving alone. The lifecycle being verified — `onLoad` ran,
      // therefore provider-backed handlers work — is independent of the
      // workflow runtime, and loading every project workflow against an
      // empty tmp directory triggers unrelated startup churn.
      workflows: [],
      channels: [],
      controlRoutes: loader.getContributedControlRoutes(),
      routes: loader.getRoutes(),
      config,
    });

    const startPromise = daemon.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const address = readControlAddress(stateDir);
      const res = await fetchWithToken(
        address.port,
        "/api/knowledge",
        address.token!,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: unknown[] };
      expect(Array.isArray(body.entries)).toBe(true);
    } finally {
      await daemon.stop();
      await startPromise;
    }
  });

  it("\"commands\" mode loader refuses to hand back routes/control-routes/health while exposing static contributions", async () => {
    const config = { defaultAgentHarness: "claude-agent-sdk" };
    const projectModules = await discoverProjectModules();
    const installedModules = await discoverModules(projectDir);
    const loader = new ModuleLoader(config, false, { mode: "commands" });
    loader.setCwd(projectDir);
    await loader.loadAll(projectModules, installedModules);

    // No provider was registered: the registry surfaces that directly,
    // independent of the loader contract.
    expect(() => getKnowledgeProvider()).toThrow(/knowledge provider/);

    // The lifecycle contract narrows to genuinely runtime-dependent accessors:
    // route handlers and control-route handlers close over onLoad-initialized
    // provider state, and module health probes do the same. Reading those from
    // a commands-mode loader is the partial-context bug class; the typed
    // boundary throws so a daemon cannot ingest them. There is no escape hatch.
    expect(() => loader.getRoutes()).toThrow(/lifecycle mode "runtime"/);
    expect(() => loader.getContributedControlRoutes()).toThrow(/lifecycle mode "runtime"/);
    await expect(loader.probeHealthChecks()).rejects.toThrow(/lifecycle mode "runtime"/);

    // Static-data accessors stay safe in commands mode because they are
    // populated from each module's definition during load(), independent of
    // onLoad side effects. CLI surfaces (workflow validate/exec, daemon
    // reload-config diff) read these without spinning up a runtime lifecycle.
    expect(() => loader.getContributedWorkflows()).not.toThrow();
    expect(() => loader.getContributedChannels()).not.toThrow();
    expect(() => loader.getSkillsPrompt()).not.toThrow();
    expect(() => loader.getAgentDef("nonexistent")).not.toThrow();
  });
});
