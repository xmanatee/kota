import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { WorkflowBlockingOperationContext } from "../blocking-operation.js";

export type BlockingFixtureInput = {
  durationMs: number;
  value: string;
};

export type BlockingFixtureOutput = {
  value: string;
  blockedForMs: number;
};

export type RecoveringFixtureInput = {
  markerPath: string;
};

export type RecoveringFixtureOutput = {
  recovered: true;
  attempts: number;
};

export function runCpuBlockingFixture(
  input: BlockingFixtureInput,
  context: WorkflowBlockingOperationContext,
): BlockingFixtureOutput {
  context.reportProgress("blocking-started");
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.durationMs) {
    // Deliberately occupy this worker's event loop for the fixture duration.
  }
  return { value: input.value, blockedForMs: Date.now() - startedAt };
}

export function failBlockingFixture(): never {
  throw new Error("fixture blocking operation failed");
}

export function recoverBlockingFixture(
  input: RecoveringFixtureInput,
): RecoveringFixtureOutput {
  const previousAttempts = existsSync(input.markerPath)
    ? Number.parseInt(readFileSync(input.markerPath, "utf8"), 10)
    : 0;
  if (!Number.isSafeInteger(previousAttempts) || previousAttempts < 0) {
    throw new Error("fixture recovery marker is invalid");
  }
  const attempts = previousAttempts + 1;
  writeFileSync(input.markerPath, `${attempts}\n`, "utf8");
  if (attempts === 1) {
    throw new Error("fixture transient blocking operation failure");
  }
  return { recovered: true, attempts };
}

export async function runProgressFixture(
  input: BlockingFixtureInput,
  context: WorkflowBlockingOperationContext,
): Promise<BlockingFixtureOutput> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < input.durationMs) {
    if (context.signal.aborted) throw new Error("progress fixture aborted");
    context.reportProgress("fixture-heartbeat");
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return { value: input.value, blockedForMs: Date.now() - startedAt };
}

/** An allocated external resource remains owned even if the worker is terminated. */
export async function runOwnedResourceFixture(
  input: { directory: string; mode: "return" | "throw" | "block" },
  context: WorkflowBlockingOperationContext,
): Promise<string> {
  const { registerOwnedProcessResource } = await import("#core/execution/owned-process-resources.js");
  const { mkdirSync } = await import("node:fs");
  registerOwnedProcessResource({ kind: "directory", path: input.directory });
  mkdirSync(input.directory);
  writeFileSync(`${input.directory}/owned`, "resource");
  context.reportProgress("resource-ready");
  if (input.mode === "throw") throw new Error("resource operation failed");
  if (input.mode === "block") while (true) { /* Deliberately uncooperative external operation. */ }
  return "resource completed";
}


export async function runCleanupFaultFixture(
  input: { directory: string; processIds?: number[]; container?: boolean; synchronousChildStarted?: string; reportBeforeRegistration?: boolean },
  context: WorkflowBlockingOperationContext,
): Promise<string> {
  const { registerOwnedProcessResource } = await import("#core/execution/owned-process-resources.js");
  const { mkdirSync } = await import("node:fs");
  if (input.reportBeforeRegistration) context.reportProgress("before-registration");
  for (const pid of input.processIds ?? []) {
    context.onProcessSpawn?.({ pid, processGroupId: pid, osStartToken: "fixture", observedCommandHash: "external-process-port" });
  }
  registerOwnedProcessResource({ kind: "directory", path: input.directory });
  mkdirSync(input.directory);
  if (input.container) registerOwnedProcessResource({ kind: "command", command: "docker", args: ["rm", "--force", "cleanup-fixture"] });
  if (input.synchronousChildStarted) {
    const { spawnSync } = await import("node:child_process");
    // This child is released by cleanup of its registered resource. It detects
    // the deadlock caused by waiting for worker exit before starting cleanup.
    const result = spawnSync(process.execPath, ["-e", `
      const fs = require("node:fs");
      fs.writeFileSync(process.argv[1], "started");
      while (fs.existsSync(process.argv[2])) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    `, input.synchronousChildStarted, input.directory], { timeout: 3000, killSignal: "SIGKILL" });
    if (result.error) throw result.error;
  }
  return "cleanup complete";
}
