import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DaemonControlAddress,
  WorkflowRunDetail,
} from "#core/daemon/daemon-control.js";
import type { EventPayloadRecord } from "#core/events/event-bus-types.js";
import {
  OUTBOUND_HTTP_PROFILES,
  outboundHttp,
} from "#core/outbound-http/index.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type {
  BlockingFixtureInput,
  BlockingFixtureOutput,
  RecoveringFixtureInput,
  RecoveringFixtureOutput,
} from "./blocking-operation-fixture.js";

export const CONTROL_REQUEST_LATENCY_BOUND_MS = 500;
export const SUCCESS_RUN_ID =
  "2026-08-13T12-00-00-000Z-control-responsive-fixture";

const fixtureModule = new URL(
  "./blocking-operation-fixture.js",
  import.meta.url,
).href;

export const cpuBlockingOperation = defineWorkflowBlockingOperation<
  BlockingFixtureInput,
  BlockingFixtureOutput
>(fixtureModule, "runCpuBlockingFixture");
export const failingOperation = defineWorkflowBlockingOperation<
  Record<string, never>,
  never
>(fixtureModule, "failBlockingFixture");
export const recoveringOperation = defineWorkflowBlockingOperation<
  RecoveringFixtureInput,
  RecoveringFixtureOutput
>(fixtureModule, "recoverBlockingFixture");

export type TimedResponse<TBody> = {
  path: string;
  durationMs: number;
  status: number;
  body: TBody;
};

export function initializeControlFixtureRepo(projectDir: string): void {
  writeFileSync(join(projectDir, ".gitignore"), ".kota/\n", "utf8");
  execFileSync("git", ["init", "--quiet"], { cwd: projectDir });
  execFileSync("git", ["config", "user.name", "Kota Tests"], {
    cwd: projectDir,
  });
  execFileSync("git", ["config", "user.email", "kota@example.com"], {
    cwd: projectDir,
  });
  execFileSync("git", ["add", ".gitignore"], { cwd: projectDir });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: projectDir,
  });
}

export async function waitForControlCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("condition was not met before timeout");
}

export async function readControlAddress(
  stateDir: string,
): Promise<DaemonControlAddress> {
  const path = join(stateDir, "daemon-control.json");
  await waitForControlCondition(() => existsSync(path));
  return JSON.parse(readFileSync(path, "utf8")) as DaemonControlAddress;
}

export async function timedControlRequest<TBody>(
  address: DaemonControlAddress,
  path: string,
  init: RequestInit = {},
): Promise<TimedResponse<TBody>> {
  const startedAt = performance.now();
  const { response } = await outboundHttp.request({
    profile: OUTBOUND_HTTP_PROFILES.daemonLoopback,
    operation: "workflow.control-responsiveness-fixture",
    url: `http://127.0.0.1:${address.port}${path}`,
    method: init.method === undefined ? "GET" : init.method as "GET" | "POST",
    body: init.body,
    headers: {
      ...(address.token !== undefined
        ? { Authorization: `Bearer ${address.token}` }
        : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    limits: { timeoutMs: 5_000, responseBytes: 1024 * 1024 },
  });
  return {
    path,
    durationMs: performance.now() - startedAt,
    status: response.status,
    body: (await response.json()) as TBody,
  };
}

export async function triggerControlWorkflow(
  address: DaemonControlAddress,
  name: string,
  runId: string,
  payload: EventPayloadRecord = {},
): Promise<void> {
  const response = await timedControlRequest<{ ok: boolean }>(
    address,
    "/workflow/trigger",
    { method: "POST", body: JSON.stringify({ name, runId, payload }) },
  );
  if (response.status !== 200 || !response.body.ok) {
    throw new Error(`Unable to trigger workflow ${name}: HTTP ${response.status}`);
  }
}

async function readRun(
  address: DaemonControlAddress,
  runId: string,
): Promise<WorkflowRunDetail | null> {
  const response = await timedControlRequest<WorkflowRunDetail | { error: string }>(
    address,
    `/workflow/runs/${runId}`,
  );
  return response.status === 200 ? (response.body as WorkflowRunDetail) : null;
}

export async function waitForRunStatus(
  address: DaemonControlAddress,
  runId: string,
  statuses: readonly string[],
): Promise<WorkflowRunDetail> {
  let found: WorkflowRunDetail | null = null;
  await waitForControlCondition(async () => {
    found = await readRun(address, runId);
    return found !== null && statuses.includes(found.status);
  });
  if (found === null) throw new Error(`run ${runId} was not found`);
  return found;
}
