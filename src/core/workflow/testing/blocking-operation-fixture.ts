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
