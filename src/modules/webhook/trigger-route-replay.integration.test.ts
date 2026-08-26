import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import type { WorkflowRuntime } from "#core/workflow/runtime.js";
import {
  createTestWorkflowRuntime,
  type TestWorkflowRuntime,
} from "#core/workflow/testing/runtime-fixture.js";
import { WORKFLOW_DISPATCHER_PROVIDER_TYPE } from "#core/workflow/workflow-dispatcher-provider.js";
import {
  startWebhookRouteTestServer,
  timestampedWebhookHeaders,
  WEBHOOK_SECRET,
  type WebhookRouteTestServer,
} from "./trigger-route-test-support.js";

function makeProjectDir(): string {
  const projectDir = mkdtempSync(join(tmpdir(), "kota-webhook-replay-"));
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n");
  execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["add", ".gitignore"], { cwd: projectDir, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=T", "commit", "-m", "init"],
    { cwd: projectDir, stdio: "ignore" },
  );
  return projectDir;
}

describe("webhook route replay protection", () => {
  let projectDir: string;
  let runtime: WorkflowRuntime;
  let runtimeFixture: TestWorkflowRuntime;
  let server: WebhookRouteTestServer;

  beforeEach(async () => {
    projectDir = makeProjectDir();
    runtimeFixture = createTestWorkflowRuntime({
      bus: new EventBus(),
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [
        {
          repository: "read",
          name: "deploy",
          definitionPath:
            "src/modules/webhook/trigger-route-replay.integration.test.ts",
          moduleRoot: process.cwd(),
          triggers: [{ webhook: true }],
          steps: [
            {
              id: "noop",
              type: "code",
              run: () => ({ ok: true }),
            },
          ],
        },
      ],
    });
    runtime = runtimeFixture.runtime;
    runtime.start();
    runtime.setDispatchPaused(true);
    server = await startWebhookRouteTestServer();
    const registry = getProviderRegistry();
    if (!registry) throw new Error("provider registry not initialized");
    registry.register(WORKFLOW_DISPATCHER_PROVIDER_TYPE, "runtime", runtime);
  });

  afterEach(async () => {
    await server.stop();
    await runtime.stop();
    runtimeFixture.runState.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("deduplicates a signed delivery replayed with a different unsigned idempotency header", async () => {
    const body = JSON.stringify({ event: "push", ref: "refs/heads/main" });
    const signedHeaders = timestampedWebhookHeaders(WEBHOOK_SECRET, body);
    const responses = [];

    for (const idempotencyKey of ["captured-delivery", "replayed-delivery"]) {
      responses.push(
        await globalThis.fetch(
          `http://127.0.0.1:${server.port}/webhooks/deploy`,
          {
            method: "POST",
            headers: {
              ...signedHeaders,
              "Content-Type": "application/json",
              "X-Kota-Idempotency-Key": idempotencyKey,
            },
            body,
          },
        ),
      );
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(results[1]).toEqual(results[0]);
    expect(runtime.getState().pendingRuns).toHaveLength(1);
  });
});
