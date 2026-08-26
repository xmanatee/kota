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
const readLiveDaemonControlAddressMock = vi.hoisted(() => vi.fn());
const isDaemonControlAddressReachableMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: spawnMock };
});

vi.mock("#core/server/daemon-control-address.js", async () => {
  const actual = await vi.importActual<
    typeof import("#core/server/daemon-control-address.js")
  >("#core/server/daemon-control-address.js");
  return {
    ...actual,
    readLiveDaemonControlAddress: readLiveDaemonControlAddressMock,
    isDaemonControlAddressReachable: isDaemonControlAddressReachableMock,
  };
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

function localClient(scopeRoot: string) {
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  const client = {} as ModuleContext["client"];
  client.forScope = () => client;
  const ctx = {
    cwd: scopeRoot,
    client,
    getProvider: () => null,
    getContributedUiSurfaces: () => [{
      moduleName: "daemon-ops",
      source: {
        sourceId: "daemon-start-test",
        scope: () => [daemonStartSurface(scopeId)],
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

let scopeRoot: string;

beforeEach(() => {
  scopeRoot = mkdtempSync(join(tmpdir(), "kota-ui-daemon-start-"));
  spawnMock.mockReset();
  readLiveDaemonControlAddressMock.mockReset();
  isDaemonControlAddressReachableMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(scopeRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("local UI daemon start", () => {
  it("reports a child-process spawn failure instead of success", async () => {
    const child = mockChild();
    const { client, input } = localClient(scopeRoot);
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
    const address = { pid: 1234, port: 4312, token: "test-token" };
    readLiveDaemonControlAddressMock.mockReturnValue(address);
    let resolveReadiness!: (ready: boolean) => void;
    isDaemonControlAddressReachableMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveReadiness = resolve;
      }),
    );
    const { client, input } = localClient(scopeRoot);
    const resultPromise = client.executeAction(input);
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());

    child.emit("spawn");
    await vi.waitFor(() => {
      expect(isDaemonControlAddressReachableMock).toHaveBeenCalledWith(address);
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
    vi.useFakeTimers();
    const child = mockChild();
    readLiveDaemonControlAddressMock.mockReturnValue(null);
    const { client, input } = localClient(scopeRoot);
    const resultPromise = client.executeAction(input);
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledOnce());

    child.emit("spawn");
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: "unavailable",
      message: "Unable to start daemon: control plane was not ready within 10000ms.",
    });
  });
});
