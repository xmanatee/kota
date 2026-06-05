/**
 * Exercises the webhook module's signature-validated workflow-trigger
 * control route end-to-end through the daemon-control server. The test
 * mounts `webhookTriggerControlRoutes` against a live `DaemonControlServer`
 * and verifies the same wire contract the route used to satisfy from core:
 * `200`/`401`/`404`/`409`/`429` status codes, `Retry-After` on rate-limit
 * exhaustion, the five-minute timestamp anti-replay window, the
 * `sha256=<hex>` / bare-hex signature tolerance, and the bearer-token
 * bypass that lets external systems POST without daemon credentials.
 *
 * The test seeds the workflow runtime through the `workflow-dispatcher`
 * and `workflow-definitions` provider seams, mirroring how the daemon
 * registers them at startup.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
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

const TEST_TOKEN = "webhook-test-token";
const WEBHOOK_SECRET = "test-webhook-secret";

function sign(secret: string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function makeHandle(): DaemonControlHandle {
  return {
    getDaemonLiveState: vi.fn(() => ({
      startedAt: "2026-01-01T00:00:00.000Z",
      completedRuns: 0,
      pid: 1,
      running: true,
    })),
    getHealthStatus: vi.fn(() => ({ scheduler: "ok" as const, modules: "ok" as const })),
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
    })),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    listSessions: vi.fn(() => []),
    setSessionAutonomyMode: vi.fn(() => ({ ok: false, notFound: true })),
    getProjectRegistryProjection: vi.fn(() => ({ defaultProjectId: "test-project-id", projects: [{ projectId: "test-project-id", projectDir: "/tmp/test-project", displayName: "test-project" }] })),
    hasProject: vi.fn((id: string) => id === "test-project-id"),
    getActiveProjectId: vi.fn(() => null),
    setActiveProjectId: vi.fn((id: string | null) => (id === null ? { ok: true as const, activeProjectId: null } : id === "test-project-id" ? { ok: true as const, activeProjectId: id } : { ok: false as const, reason: "not_found" as const, projectId: id })),
    reloadConfig: vi.fn(async () => ({ workflows: 0, changedModules: [], sessionGuardrails: { refreshed: 0, unchanged: 0, nonRefreshable: [] } })),
    probeCapabilityReadiness: vi.fn(async () => ({ capabilities: [], summary: { ready: 0, unavailable: 0, init_failed: 0 } })),
    getClientIdentity: vi.fn(async () => ({
      projectName: "test-project",
      projectDir: "/tmp/test-project",
      projects: { defaultProjectId: "test-project-id", projects: [{ projectId: "test-project-id", projectDir: "/tmp/test-project", displayName: "test-project" }] },
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

function registerDispatcher(
  result: EnqueueWebhookRunResult | (() => EnqueueWebhookRunResult),
): Mock<(name: string, payload: WebhookRunPayload) => EnqueueWebhookRunResult> {
  const fn = vi.fn(
    (_name: string, _payload: WebhookRunPayload) =>
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

function registerDefinitions(
  rateLimit: Record<string, { maxPerMinute: number }> = {},
): void {
  const source: WorkflowDefinitionsSource = {
    getWebhookRateLimit: (name) => rateLimit[name],
  };
  const registry = getProviderRegistry();
  if (!registry) throw new Error("provider registry not initialized");
  registry.register(WORKFLOW_DEFINITIONS_PROVIDER_TYPE, "test", source);
}

describe("webhook module signature-validated trigger route", () => {
  let server: DaemonControlServer;
  let port: number;

  beforeEach(async () => {
    resetProviderRegistry();
    initProviderRegistry();
    server = new DaemonControlServer(makeHandle(), TEST_TOKEN, {
      controlRoutes: webhookTriggerControlRoutes(() => ({
        webhooks: { deploy: { secret: WEBHOOK_SECRET } },
      })),
    });
    port = await server.start();
    registerDefinitions();
  });

  afterEach(async () => {
    await server.stop();
    resetProviderRegistry();
  });

  it("returns 200 with runId when signature is correct", async () => {
    registerDispatcher({ ok: true, runId: "2026-01-01T00-00-00-000Z-deploy-abc123" });
    const bodyStr = JSON.stringify({ ref: "refs/heads/main" });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, bodyStr),
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: "2026-01-01T00-00-00-000Z-deploy-abc123" });
  });

  it("returns 401 when signature header is missing", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": "sha256=badhex" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when no secret is configured for the workflow", async () => {
    registerDispatcher({ ok: true, runId: "unused" });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/unknown-secret`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when workflow not found", async () => {
    registerDispatcher({ ok: false, notFound: true });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when workflow is already running", async () => {
    registerDispatcher({ ok: false, alreadyRunning: true });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(409);
  });

  it("does not require daemon Bearer token", async () => {
    registerDispatcher({ ok: true, runId: "no-bearer-runid" });
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(200);
  });

  it("forwards JSON body, headers, and timestamp into the dispatcher payload", async () => {
    const fn = registerDispatcher({ ok: true, runId: "test-run-id" });
    const bodyStr = JSON.stringify({ event: "push" });
    await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, bodyStr),
        "X-Kota-Webhook-Timestamp": String(Date.now()),
        "X-Kota-Idempotency-Key": "delivery-42",
        "Content-Type": "application/json",
      },
      body: bodyStr,
    });
    expect(fn).toHaveBeenCalledWith(
      "deploy",
      expect.objectContaining({
        body: { event: "push" },
        headers: expect.objectContaining({ "content-type": "application/json" }),
        timestamp: expect.any(String),
        idempotencyKey: expect.any(String),
      }),
    );
    const passedHeaders = fn.mock.calls[0][1].headers;
    expect(passedHeaders).not.toHaveProperty("x-kota-webhook-signature");
    expect(passedHeaders).not.toHaveProperty("x-kota-webhook-timestamp");
    expect(passedHeaders).not.toHaveProperty("x-kota-idempotency-key");
  });

  it("derives a stable idempotency key from repeated signed bodies", async () => {
    const fn = registerDispatcher({ ok: true, runId: "test-run-id" });
    const bodyStr = JSON.stringify({ event: "push", ref: "refs/heads/main" });
    for (let i = 0; i < 2; i++) {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: {
          "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, bodyStr),
          "Content-Type": "application/json",
        },
        body: bodyStr,
      });
      expect(res.status).toBe(200);
    }

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0][1].idempotencyKey).toBe(fn.mock.calls[1][1].idempotencyKey);
    expect(fn.mock.calls[0][1].idempotencyKey).toMatch(/^webhook-body:/);
  });

  it("accepts bare hex signature without the sha256= prefix", async () => {
    registerDispatcher({ ok: true, runId: "bare-hex" });
    const bareHex = createHmac("sha256", WEBHOOK_SECRET).update("").digest("hex");
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": bareHex },
    });
    expect(res.status).toBe(200);
  });

  it("returns 429 with Retry-After header when rate limit is exceeded", async () => {
    registerDispatcher({ ok: true, runId: "rate-limit" });
    registerDefinitions({ deploy: { maxPerMinute: 2 } });
    const sig = sign(WEBHOOK_SECRET, "");
    for (let i = 0; i < 2; i++) {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
        method: "POST",
        headers: { "X-Kota-Webhook-Signature": sig },
      });
      expect(res.status).toBe(200);
    }
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sig },
    });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter!, 10)).toBeGreaterThan(0);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringContaining("rate limit") });
    expect(typeof body.retryAfterSec).toBe("number");
  });

  it("rejects stale timestamps outside the five-minute replay window", async () => {
    registerDispatcher({ ok: true, runId: "stale-ts" });
    const staleTs = String(Date.now() - 10 * 60 * 1000);
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: {
        "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, ""),
        "X-Kota-Webhook-Timestamp": staleTs,
      },
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed workflow names with 404", async () => {
    registerDispatcher({ ok: true, runId: "should-not-be-called" });
    const res = await globalThis.fetch(
      `http://127.0.0.1:${port}/webhooks/${encodeURIComponent("bad name")}`,
      { method: "POST", headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") } },
    );
    expect(res.status).toBe(404);
  });

  it("returns 503 when the workflow runtime providers are unavailable", async () => {
    resetProviderRegistry();
    initProviderRegistry();
    const res = await globalThis.fetch(`http://127.0.0.1:${port}/webhooks/deploy`, {
      method: "POST",
      headers: { "X-Kota-Webhook-Signature": sign(WEBHOOK_SECRET, "") },
    });
    expect(res.status).toBe(503);
  });
});
