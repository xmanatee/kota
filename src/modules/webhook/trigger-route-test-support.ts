import { createHmac } from "node:crypto";
import { type Mock, vi } from "vitest";
import {
  type DaemonControlHandle,
  DaemonControlServer,
  type WorkflowMetricCounts,
} from "#core/daemon/daemon-control.js";
import { daemonSetupControlHandleStubs } from "#core/daemon/daemon-setup-control-test-stubs.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import {
  WORKFLOW_DEFINITIONS_PROVIDER_TYPE,
  type WorkflowDefinitionsSource,
} from "#core/workflow/workflow-definitions-provider.js";
import {
  type EnqueueWebhookRunResult,
  type WebhookRunPayload,
  WORKFLOW_DISPATCHER_PROVIDER_TYPE,
  type WorkflowDispatcher,
} from "#core/workflow/workflow-dispatcher-provider.js";
import { webhookTriggerControlRoutes } from "./trigger-route.js";

export const TEST_TOKEN = "webhook-test-token";
export const WEBHOOK_SECRET = "test-webhook-secret";

export type WebhookRouteTestServer = {
  port: number;
  stop: () => Promise<void>;
};

export function signBodyOnly(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function signTimestamped(
  secret: string,
  timestamp: string,
  body: string | Buffer,
): string {
  return `sha256-v2=${createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(body)
    .digest("hex")}`;
}

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({
      scheduler: "ok" as const,
      modules: "ok" as const,
    })),
    getWorkflowLiveStatus: vi.fn(() => ({
      activeRuns: [],
      pendingRuns: [],
      queueLength: 0,
      completedRuns: 0,
      workflows: {},
      paused: false,
      agentConcurrency: 1,
      codeConcurrency: 4,
    })),
    listChannelStatuses: vi.fn(() => []),
    pauseWorkflowDispatch: vi.fn(() => ({ already: false })),
    resumeWorkflowDispatch: vi.fn(() => ({ already: false })),
    abortActiveRuns: vi.fn(() => ({ aborted: 0 })),
    abortActiveRun: vi.fn(() => ({ ok: false, notFound: true })),
    reloadWorkflowDefinitions: vi.fn(() => ({ count: 0 })),
    getWorkflowDefinitions: vi.fn(() => []),
    enableWorkflow: vi.fn(() => ({ ok: true })),
    disableWorkflow: vi.fn(() => ({ ok: true })),
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    cancelQueuedRun: vi.fn(() => ({ ok: false, notFound: true })),
    subscribeToEvents: vi.fn(() => () => {}),
    listWorkflowRuns: vi.fn(() => []),
    getWorkflowRun: vi.fn(() => null),
    getWorkflowMetricCounts: vi.fn((): WorkflowMetricCounts => ({
      runCounts: [],
      costTotals: [],
      durationHistogram: [],
      deadLetterCounts: { open: 0, dismissed: 0, redriven: 0 },
    })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getProjectRegistryProjection: vi.fn(() => ({
      defaultProjectId: "test-project-id",
      projects: [
        {
          projectId: "test-project-id",
          projectDir: "/tmp/test-project",
          displayName: "test-project",
        },
      ],
    })),
    hasProject: vi.fn((id: string) => id === "test-project-id"),
    getActiveProjectId: vi.fn(() => null),
    setActiveProjectId: vi.fn((id: string | null) =>
      id === null
        ? { ok: true as const, activeProjectId: null }
        : id === "test-project-id"
          ? { ok: true as const, activeProjectId: id }
          : { ok: false as const, reason: "not_found" as const, projectId: id },
    ),
    reloadConfig: vi.fn(async () => ({
      workflows: 0,
      changedModules: [],
      sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] },
    })),
    probeCapabilityReadiness: vi.fn(async () => ({
      capabilities: [],
      summary: { ready: 0, unavailable: 0, init_failed: 0 },
    })),
    getClientIdentity: vi.fn(async () => ({
      projectName: "test-project",
      projectDir: "/tmp/test-project",
      projects: {
        defaultProjectId: "test-project-id",
        projects: [
          {
            projectId: "test-project-id",
            projectDir: "/tmp/test-project",
            displayName: "test-project",
          },
        ],
      },
      daemonVersion: "0.1.0",
      pid: 9999,
      startedAt: "2026-01-01T00:00:00.000Z",
      dashboard: {
        available: false as const,
        reason: "not_contributed",
        message: "No module contributed a dashboard capability.",
      },
    })),
    ...daemonSetupControlHandleStubs(),
  };
}

export function registerDispatcher(
  result: EnqueueWebhookRunResult | (() => EnqueueWebhookRunResult),
): Mock<(name: string, payload: WebhookRunPayload) => EnqueueWebhookRunResult> {
  const fn = vi.fn((_name: string, _payload: WebhookRunPayload) =>
    typeof result === "function" ? result() : result,
  );
  const dispatcher: WorkflowDispatcher = {
    enqueuePendingRun: vi.fn(() => ({ ok: true })),
    enqueueWebhookRun: fn,
  };
  const registry = getProviderRegistry();
  if (!registry) throw new Error("provider registry not initialized");
  registry.register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "test", dispatcher);
  return fn;
}

export function registerDefinitions(
  rateLimit: Record<string, { maxPerMinute: number }> = {},
): void {
  const source: WorkflowDefinitionsSource = {
    getWebhookRateLimit: (name) => rateLimit[name],
  };
  const registry = getProviderRegistry();
  if (!registry) throw new Error("provider registry not initialized");
  registry.register(WORKFLOW_DEFINITIONS_PROVIDER_TYPE, "test", source);
}

export function resetWorkflowRuntimeProvidersForTest(): void {
  resetProviderRegistry();
  initProviderRegistry();
}

export async function startWebhookRouteTestServer(): Promise<WebhookRouteTestServer> {
  resetWorkflowRuntimeProvidersForTest();
  const server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
    controlRoutes: webhookTriggerControlRoutes(() => ({
      webhooks: { deploy: { secret: WEBHOOK_SECRET } },
    })),
  });
  const port = await server.start();
  registerDefinitions();
  return {
    port,
    async stop() {
      await server.stop();
      resetProviderRegistry();
    },
  };
}
