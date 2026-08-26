import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChannelStartContext } from "#core/channels/channel.js";
import { registerWorkflowDefinition } from "#core/workflow/validation.js";
import { Daemon } from "./daemon.js";
import { deriveDirectoryScopeId } from "./scope-registry.js";

type ControlAddress = { port: number; token: string };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await wait(20);
  }
  expect(predicate()).toBe(true);
}

async function startDaemon(daemon: Daemon, stateDir: string): Promise<{
  address: ControlAddress;
  startPromise: Promise<void>;
}> {
  const controlPath = join(stateDir, "daemon-control.json");
  const startPromise = daemon.start();
  await waitFor(() => existsSync(controlPath));
  const address = JSON.parse(readFileSync(controlPath, "utf8")) as ControlAddress;
  return { address, startPromise };
}

async function requestJson(
  address: ControlAddress,
  path: string,
  init?: RequestInit,
): Promise<Record<string, any>> {
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${address.token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const text = await response.text();
  expect(response.ok, text).toBe(true);
  return JSON.parse(text) as Record<string, any>;
}

function directorySnapshot(root: string): string[] {
  const entries: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const key = relative(root, path);
      const stats = lstatSync(path);
      if (stats.isDirectory()) {
        entries.push(`d:${key}`);
        visit(path);
      } else if (stats.isFile()) {
        entries.push(`f:${key}:${readFileSync(path).toString("base64")}`);
      } else {
        entries.push(`o:${key}`);
      }
    }
  };
  visit(root);
  return entries;
}

describe("live directory scope lifecycle", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("registers, runs, restores, drains, and removes one live scope without touching its files", async () => {
    const root = mkdtempSync(join(tmpdir(), "kota-live-scope-"));
    roots.push(root);
    const scopeA = mkdtempSync(join(root, "scope-a-"));
    const scopeB = mkdtempSync(join(root, "scope-b-"));
    const stateDir = mkdtempSync(join(root, "daemon-state-"));
    writeFileSync(join(scopeB, "operator-owned.txt"), "preserve me");
    const scopeAId = deriveDirectoryScopeId(scopeA);
    const scopeBId = deriveDirectoryScopeId(scopeB);
    let releaseHold: (() => void) | null = null;
    let holdStarted = false;
    let fastExecution: { projectDir: string; scopeDir: string } | null = null;
    let channelContext: ChannelStartContext | null = null;
    let channelSessionScopeId: string | null = null;

    const workflows = [
      registerWorkflowDefinition("test/live-scope-fast.ts", {
        repository: "none",
        name: "live-scope-fast",
        triggers: [{ event: "test.live-scope.fast" }],
        steps: [{
          id: "write",
          type: "code",
          run: (ctx) => {
            fastExecution = { projectDir: ctx.projectDir, scopeDir: ctx.scopeDir };
            return fastExecution;
          },
        }],
      }),
      registerWorkflowDefinition("test/live-scope-hold.ts", {
        repository: "none",
        name: "live-scope-hold",
        triggers: [{ event: "test.live-scope.hold" }],
        steps: [{
          id: "hold",
          type: "code",
          run: async () => {
            holdStarted = true;
            await new Promise<void>((resolve) => {
              releaseHold = resolve;
            });
            return "released";
          },
        }],
      }),
    ];

    const first = new Daemon({
      projectDir: scopeA,
      stateDir,
      workflows,
      channels: [{
        name: "scope-lifecycle-fixture",
        create: (ctx) => {
          channelContext = ctx;
          return {
            status: "started",
            adapter: {
              async start() {},
              stop() {},
              listScopeSessionIds: (scopeId) =>
                channelSessionScopeId === scopeId ? ["fixture-channel-session"] : [],
            },
          };
        },
      }],
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
    });
    const firstRun = await startDaemon(first, stateDir);
    await waitFor(() => channelContext !== null);
    const registration = await first.registerDirectoryScope({
      directoryRoot: scopeB,
      displayName: "Live B",
    });
    expect(registration).toMatchObject({ ok: true, scope: { scopeId: scopeBId } });
    expect(first.getHostedScopeCount()).toBe(2);
    expect(channelContext!.getDefaultProjectRuntime().project.projectId).toBe(scopeAId);
    expect(await first.setDefaultScope(scopeBId))
      .toMatchObject({ ok: true, status: "default_changed" });
    expect(channelContext!.getDefaultProjectRuntime().project.projectId).toBe(scopeBId);
    expect(channelContext!.getWorkflowStatus().runsDir).toBe(
      join(realpathSync(scopeB), ".kota", "runs"),
    );
    expect(await first.setDefaultScope(scopeAId))
      .toMatchObject({ ok: true, status: "default_changed" });

    channelSessionScopeId = scopeBId;
    expect(await first.drainScope(scopeBId)).toMatchObject({
      ok: false,
      reason: "scope_busy",
      blockers: expect.arrayContaining([
        expect.objectContaining({
          kind: "session",
          ids: ["fixture-channel-session"],
          requiredDisposition: "close",
        }),
      ]),
    });
    channelSessionScopeId = null;
    const liveScopes = await requestJson(firstRun.address, "/scopes");
    expect(liveScopes.scopes.map((scope: any) => scope.scopeId)).toContain(scopeBId);
    const compatibility = await requestJson(firstRun.address, "/projects");
    expect(compatibility.projects.map((project: any) => project.projectId)).toContain(scopeBId);
    await requestJson(firstRun.address, "/projects/active", {
      method: "PATCH",
      body: JSON.stringify({ projectId: scopeBId }),
    });
    expect(await requestJson(firstRun.address, "/projects/active"))
      .toEqual({ activeProjectId: scopeBId });

    await requestJson(firstRun.address, `/workflow/trigger?scopeId=${scopeBId}`, {
      method: "POST",
      body: JSON.stringify({ name: "live-scope-fast" }),
    });
    await waitFor(() => fastExecution !== null);
    const executedIn = fastExecution as { projectDir: string; scopeDir: string } | null;
    const canonicalScopeB = realpathSync(scopeB);
    expect(executedIn?.scopeDir).toBe(canonicalScopeB);
    expect(relative(canonicalScopeB, executedIn!.projectDir).startsWith(
      `${join(".kota", "runtime")}${sep}`,
    )).toBe(true);
    await first.stop(0);
    await firstRun.startPromise;

    channelContext = null;
    const restored = new Daemon({
      projects: [{ projectDir: scopeA }],
      stateDir,
      workflows,
      channels: [{
        name: "scope-lifecycle-restored-fixture",
        create: (ctx) => {
          channelContext = ctx;
          return {
            status: "started",
            adapter: {
              async start() {},
              stop() {},
              listScopeSessionIds: () => [],
            },
          };
        },
      }],
      idleIntervalMs: 60_000,
      pollIntervalMs: 60_000,
    });
    const restoredRun = await startDaemon(restored, stateDir);
    await waitFor(() => channelContext !== null);
    expect(restored.getHostedScopeCount()).toBe(2);
    expect(restored.getScopeRegistryProjection()).toMatchObject({
      defaultScopeId: scopeAId,
      scopes: expect.arrayContaining([
        expect.objectContaining({ scopeId: scopeBId, displayName: "Live B" }),
      ]),
    });
    await requestJson(restoredRun.address, "/projects/active", {
      method: "PATCH",
      body: JSON.stringify({ projectId: scopeBId }),
    });

    await requestJson(restoredRun.address, `/workflow/trigger?scopeId=${scopeBId}`, {
      method: "POST",
      body: JSON.stringify({ name: "live-scope-hold" }),
    });
    await waitFor(() => holdStarted);
    const blocked = await restored.drainScope(scopeBId);
    expect(blocked).toMatchObject({
      ok: false,
      reason: "scope_busy",
      blockers: expect.arrayContaining([expect.objectContaining({ kind: "active_run" })]),
    });
    expect(await restored.removeScope(scopeBId))
      .toMatchObject({ ok: false, reason: "scope_not_drained" });
    const release = releaseHold as (() => void) | null;
    release?.();
    await waitFor(() => !restored.hasActiveWorkflow());
    expect(await restored.drainScope(scopeBId)).toMatchObject({ ok: true, status: "drained" });
    expect(() => channelContext?.getProjectRuntime(scopeBId)).toThrow(
      `Scope ${scopeBId} is drained and cannot accept channel work`,
    );
    const beforeRemoval = directorySnapshot(scopeB);
    expect(await restored.removeScope(scopeBId)).toMatchObject({ ok: true, status: "removed" });
    expect(directorySnapshot(scopeB)).toEqual(beforeRemoval);
    expect(restored.getScopeRegistryProjection().scopes.map((scope) => scope.scopeId)).not.toContain(scopeBId);
    expect(restored.getHostedScopeCount()).toBe(1);
    expect(await requestJson(restoredRun.address, "/projects/active"))
      .toEqual({ activeProjectId: null });

    await restored.stop(0);
    await restoredRun.startPromise;
  });
});
