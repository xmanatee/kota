import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
} from "./daemon-control.js";

const TEST_TOKEN = "test-secret-token-abc123";
const PROJECT_ID = "test-project-id";

function makeHandle(
  overrides: Partial<DaemonControlHandle> = {},
): DaemonControlHandle {
  return {
    subscribeToEvents: vi.fn(() => () => {}),
    getActiveProjectId: vi.fn(() => null),
    getScopeHostingState: vi.fn(() => "hosted"),
    hasProject: vi.fn(() => true),
    getProjectRegistryProjection: vi.fn(() => ({
      defaultProjectId: PROJECT_ID,
      projects: [
        {
          projectId: PROJECT_ID,
          projectDir: "/tmp/test-project",
          displayName: "test-project",
        },
      ],
    })),
    getWorkflowLiveStatus: vi.fn(),
    setActiveProjectId: vi.fn(() => ({
      ok: true,
      activeProjectId: PROJECT_ID,
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
        setActiveProjectId: vi.fn(() => ({
          ok: false,
          reason: "not_hosted",
          projectId: PROJECT_ID,
          state: "draining",
        }) as const),
      }),
      TEST_TOKEN,
    );
    port = await server.start();

    const response = await request(port, "/projects/active", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: `Project scope ${PROJECT_ID} is draining`,
      reason: "scope_not_hosted",
      projectId: PROJECT_ID,
      scopeId: PROJECT_ID,
      state: "draining",
    });
  });

  it("rejects status reads for a registered scope that is no longer hosted", async () => {
    const handle = makeHandle({ hasProject: vi.fn(() => false) });
    await server.stop();
    server = new DaemonControlServer(handle, TEST_TOKEN);
    port = await server.start();

    const response = await request(
      port,
      `/workflow/status?scopeId=${PROJECT_ID}`,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Scope is not hosted",
      reason: "scope_not_hosted",
      scopeId: PROJECT_ID,
      projectId: PROJECT_ID,
    });
    expect(handle.getWorkflowLiveStatus).not.toHaveBeenCalled();
  });

  it("rejects workflow admission when the scope starts draining", async () => {
    await server.stop();
    server = new DaemonControlServer(
      makeHandle({
        enqueuePendingRun: vi.fn(() => ({
          ok: false,
          error: `Scope ${PROJECT_ID} is draining and cannot accept workflow runs`,
          reason: "scope_not_hosted",
          scopeId: PROJECT_ID,
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
      error: `Scope ${PROJECT_ID} is draining and cannot accept workflow runs`,
      reason: "scope_not_hosted",
      scopeId: PROJECT_ID,
      state: "draining",
    });
  });
});
