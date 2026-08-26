import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
} from "./daemon-control.js";

const TEST_TOKEN = "test-secret-token-abc123";
const SCOPE_ID = "test-scope-id";

function makeHandle(
  overrides: Partial<DaemonControlHandle> = {},
): DaemonControlHandle {
  return {
    subscribeToEvents: vi.fn(() => () => {}),
    getActiveScopeId: vi.fn(() => null),
    getScopeHostingState: vi.fn(() => "hosted"),
    hasScope: vi.fn(() => true),
    getScopeRegistryProjection: vi.fn(() => ({
      defaultScopeId: SCOPE_ID,
      scopes: [
        {
          scopeId: SCOPE_ID,
          scopeRoot: "/tmp/test-scope",
          displayName: "test-scope",
        },
      ],
    })),
    getWorkflowLiveStatus: vi.fn(),
    setActiveScopeId: vi.fn(() => ({
      ok: true,
      activeScopeId: SCOPE_ID,
    })),
    enqueuePendingRun: vi.fn(() => ({ ok: true, queued: "builder" })),
    ...overrides,
  } as unknown as DaemonControlHandle;
}

async function request(
  port: number,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TEST_TOKEN}`,
      ...options.headers,
    },
  });
}

describe("DaemonControlServer scope hosting admission", () => {
  let server: DaemonControlServer;
  let port: number;

  beforeEach(async () => {
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN);
    port = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("rejects selecting a registered but draining scope", async () => {
    await server.stop();
    server = new DaemonControlServer(
      makeHandle({
        setActiveScopeId: vi.fn(() => ({
          ok: false,
          reason: "not_hosted",
          scopeId: SCOPE_ID,
          state: "draining",
        }) as const),
      }),
      TEST_TOKEN,
    );
    port = await server.start();

    const response = await request(port, "/scopes/active", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scopeId: SCOPE_ID }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `Scope ${SCOPE_ID} is draining`,
      reason: "scope_not_hosted",
      scopeId: SCOPE_ID,
      state: "draining",
    });
  });

  it("rejects status reads for a registered scope that is no longer hosted", async () => {
    const handle = makeHandle({ hasScope: vi.fn(() => false) });
    await server.stop();
    server = new DaemonControlServer(handle, TEST_TOKEN);
    port = await server.start();

    const response = await request(
      port,
      `/workflow/status?scopeId=${SCOPE_ID}`,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Scope is not hosted",
      reason: "scope_not_hosted",
      scopeId: SCOPE_ID,
    });
    expect(handle.getWorkflowLiveStatus).not.toHaveBeenCalled();
  });

  it("rejects workflow admission when the scope starts draining", async () => {
    await server.stop();
    server = new DaemonControlServer(
      makeHandle({
        enqueuePendingRun: vi.fn(() => ({
          ok: false,
          error: `Scope ${SCOPE_ID} is draining and cannot accept workflow runs`,
          reason: "scope_not_hosted",
          scopeId: SCOPE_ID,
          state: "draining",
        }) as const),
      }),
      TEST_TOKEN,
    );
    port = await server.start();

    const response = await request(port, "/workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "builder" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `Scope ${SCOPE_ID} is draining and cannot accept workflow runs`,
      reason: "scope_not_hosted",
      scopeId: SCOPE_ID,
      state: "draining",
    });
  });
});
