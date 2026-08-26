import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { action, resultSpec } from "#core/daemon/ui-surface-builders.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { UiSurface } from "./operator-ui.js";
import { buildLocalUiClient } from "./ui-clients.js";

const spawnMock = vi.hoisted(() => vi.fn());
const waitForDaemonControlPlaneMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock };
});

vi.mock("./daemon-readiness.js", () => {
  return { waitForDaemonControlPlane: waitForDaemonControlPlaneMock };
});

type MockChild = EventEmitter & { unref: ReturnType<typeof vi.fn> };

function daemonStartSurface(scopeId: string): UiSurface {
  return {
    protocolVersion: "ui.surface.v1",
    surfaceId: "status",
    extensionId: "daemon-ops.test-status",
    title: "Status",
    intent: "Status",
    scopeId,
    attachmentPoint: { kind: "root" },
    order: 1,
    refreshEvents: [],
    nodes: [],
    actions: [action({
      surfaceId: "status",
      actionId: "daemon.start",
      scopeId,
      label: "Start daemon",
      effect: "write",
      operation: {
        kind: "client-namespace",
        namespace: "daemonOps",
        method: "start",
      },
      result: resultSpec("Daemon started."),
    })],
  };
}

function localClient(projectDir: string) {
  const scopeId = deriveDirectoryScopeId(projectDir);
  const client = {} as ModuleContext["client"];
  client.forScope = () => client;
  client.forProject = () => client;
  const ctx = {
    cwd: projectDir,
    client,
    getProvider: () => null,
    getContributedUiSurfaces: () => [{
      moduleName: "daemon-ops",
      source: {
        sourceId: "daemon-start-test",
        project: () => [daemonStartSurface(scopeId)],
      },
    }],
  } as unknown as ModuleContext;
  return {
    client: buildLocalUiClient(ctx),
    input: { surfaceId: "status", actionId: "daemon.start", scopeId },
  };
}

function mockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.on("error", () => {});
  child.unref = vi.fn();
  spawnMock.mockReturnValue(child);
  return child;
}

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "kota-ui-daemon-start-"));
  spawnMock.mockReset();
  waitForDaemonControlPlaneMock.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(projectDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("local UI daemon start", () => {
  it("reports a child-process spawn failure instead of success", async () => {
    const child = mockChild();
    const { client, input } = localClient(projectDir);
    const resultPromise = client.executeAction(input);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());

    child.emit("error", new Error("spawn failed"));

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      message: "Unable to start daemon: spawn failed",
    });
  });

  it("does not report success until the spawned daemon control plane is reachable", async () => {
    const child = mockChild();
    let resolveReadiness!: (ready: boolean) => void;
    waitForDaemonControlPlaneMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveReadiness = resolve;
      }),
    );
    const { client, input } = localClient(projectDir);
    const resultPromise = client.executeAction(input);
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());

    child.emit("spawn");
    await vi.waitFor(() => {
      expect(waitForDaemonControlPlaneMock).toHaveBeenCalledWith(projectDir);
    });
    expect(settled).toBe(false);

    resolveReadiness(true);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      message: "Daemon started.",
    });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("reports unavailable when the spawned daemon never publishes a ready control plane", async () => {
    const child = mockChild();
    waitForDaemonControlPlaneMock.mockResolvedValue(false);
    const { client, input } = localClient(projectDir);
    const resultPromise = client.executeAction(input);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());

    child.emit("spawn");

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      message: "Unable to start daemon: control plane was not ready within 10000ms.",
    });
  });
});
