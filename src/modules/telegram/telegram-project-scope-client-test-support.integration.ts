import { vi } from "vitest";
import type { KotaClient } from "#core/server/kota-client.js";
import type { CaptureClient } from "#modules/capture/client.js";
import type { MemoryClient } from "#modules/memory/client.js";
import type { RetractClient } from "#modules/retract/client.js";
import {
  PROJECT_A,
  PROJECT_B,
} from "./telegram-project-scope-daemon-test-support.integration.js";

export type ProjectSpies = {
  workflowStatus: ReturnType<typeof vi.fn<KotaClient["workflow"]["status"]>>;
  memorySearch: ReturnType<typeof vi.fn<MemoryClient["search"]>>;
  capture: ReturnType<typeof vi.fn<CaptureClient["capture"]>>;
  retract: ReturnType<typeof vi.fn<RetractClient["retract"]>>;
};

function makeProjectClient(
  project: typeof PROJECT_A,
  spies: ProjectSpies,
): KotaClient {
  return {
    forProject: vi.fn(() => makeProjectClient(project, spies)),
    workflow: {
      status: spies.workflowStatus,
    },
    memory: {
      list: vi.fn(async () => ({ entries: [] })),
      add: vi.fn(async () => ({ id: `${project.projectId}-memory` })),
      delete: vi.fn(async () => ({ ok: true as const })),
      search: spies.memorySearch,
      reindex: vi.fn(async () => ({ indexed: 0, failed: 0 })),
    },
    capture: { capture: spies.capture },
    retract: { retract: spies.retract },
  } as unknown as KotaClient;
}

export function makeClient(
  spiesByProject: Map<string, ProjectSpies>,
  projectsListResult?: Awaited<ReturnType<KotaClient["projects"]["list"]>>,
): KotaClient {
  const projectClients = new Map<string, KotaClient>();
  for (const project of [PROJECT_A, PROJECT_B]) {
    projectClients.set(
      project.projectId,
      makeProjectClient(project, spiesByProject.get(project.projectId)!),
    );
  }
  const listResult = projectsListResult ?? {
    ok: true as const,
    defaultProjectId: PROJECT_A.projectId,
    activeProjectId: null,
    projects: [PROJECT_A, PROJECT_B],
  };
  return {
    forProject: vi.fn((projectId: string) => {
      const client = projectClients.get(projectId);
      if (!client) throw new Error(`Unknown project: ${projectId}`);
      return client;
    }),
    projects: {
      list: vi.fn(async () => listResult),
      use: vi.fn(),
    },
  } as unknown as KotaClient;
}

export function makeSpies(): Map<string, ProjectSpies> {
  return new Map([
    [
      PROJECT_A.projectId,
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
              content: "alpha lives only in project A",
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
      PROJECT_B.projectId,
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
    runsDir: "/tmp/project-a/.kota/runs",
  };
}
