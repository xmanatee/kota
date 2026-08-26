import { vi } from "vitest";
import type { KotaClient } from "#core/server/kota-client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import {
  SCOPE_A,
  SCOPE_B,
} from "./telegram-scope-daemon-test-support.integration.js";

export type ScopeSpies = {
  workflowStatus: ReturnType<typeof vi.fn<KotaClient["workflow"]["status"]>>;
  memorySearch: ReturnType<typeof vi.fn<MemoryClient["search"]>>;
  capture: ReturnType<typeof vi.fn<CaptureClient["capture"]>>;
  retract: ReturnType<typeof vi.fn<RetractClient["retract"]>>;
};

function makeScopeClient(
  scope: typeof SCOPE_A,
  spies: ScopeSpies,
): KotaClient {
  return {
    forScope: vi.fn(() => makeScopeClient(scope, spies)),
    workflow: {
      status: spies.workflowStatus,
    },
    memory: {
      list: vi.fn(async () => ({ entries: [] })),
      add: vi.fn(async () => ({ id: `${scope.scopeId}-memory` })),
      delete: vi.fn(async () => ({ ok: true as const })),
      search: spies.memorySearch,
      reindex: vi.fn(async () => ({ indexed: 0, failed: 0 })),
    },
    capture: { capture: spies.capture },
    retract: { retract: spies.retract },
  } as unknown as KotaClient;
}

export function makeClient(
  spiesByScope: Map<string, ScopeSpies>,
  scopesListResult?: Awaited<ReturnType<KotaClient["scopes"]["list"]>>,
): KotaClient {
  const scopeClients = new Map<string, KotaClient>();
  for (const scope of [SCOPE_A, SCOPE_B]) {
    scopeClients.set(
      scope.scopeId,
      makeScopeClient(scope, spiesByScope.get(scope.scopeId)!),
    );
  }
  const listResult = scopesListResult ?? {
    ok: true as const,
    defaultScopeId: SCOPE_A.scopeId,
    activeScopeId: null,
    scopes: [SCOPE_A, SCOPE_B],
  };
  return {
    forScope: vi.fn((scopeId: string) => {
      const client = scopeClients.get(scopeId);
      if (!client) throw new Error(`Unknown scope: ${scopeId}`);
      return client;
    }),
    scopes: {
      list: vi.fn(async () => listResult),
      use: vi.fn(),
    },
  } as unknown as KotaClient;
}

export function makeSpies(): Map<string, ScopeSpies> {
  return new Map([
    [
      SCOPE_A.scopeId,
      {
        workflowStatus: vi.fn(async () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: false,
          pendingAbort: false,
          concurrency: 4,
        })),
        memorySearch: vi.fn(async () => ({
          ok: true as const,
          entries: [
            {
              id: "mem-a",
              created: "2026-05-14T00:00:00.000Z",
              content: "alpha lives only in scope A",
            },
          ],
        })),
        capture: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "capture-a" },
        })),
        retract: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "retract-a" },
        })),
      },
    ],
    [
      SCOPE_B.scopeId,
      {
        workflowStatus: vi.fn(async () => ({
          activeRuns: [],
          pendingRuns: [],
          queueLength: 0,
          completedRuns: 0,
          workflows: {},
          paused: true,
          pendingAbort: false,
          concurrency: 4,
        })),
        memorySearch: vi.fn(async () => ({
          ok: true as const,
          entries: [],
        })),
        capture: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "capture-b" },
        })),
        retract: vi.fn(async () => ({
          ok: true as const,
          record: { target: "memory" as const, recordId: "mem-b" },
        })),
      },
    ],
  ]);
}

export function makeStatusInfo() {
  return {
    runtimeState: {
      completedRuns: 0,
      pendingRuns: [],
      workflows: {},
    },
    dispatchPaused: false,
    runsDir: "/tmp/scope-a/.kota/runs",
  };
}
