/**
 * Pausable await-event step persistence.
 *
 * The await-event step (`steps/step-executor-await-event.ts`) writes a
 * suspension record when it starts waiting and a delivery record when the
 * matching event arrives. Both files live under `.kota/runs/<run-id>/awaits/`
 * so the same run directory holds the entire suspension lifecycle. On daemon
 * restart, the runtime scans these files via `awaits-resume.ts` and queues a
 * resume run that re-enters the awaiting step with the persisted payload.
 *
 * The store is intentionally narrow: it owns reading/writing the suspension
 * and delivery JSON shapes. Subscription and queue handoff live in the
 * executor and runtime so this file has no event-bus or store dependencies.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";

export type AwaitMatchScalar = string | number;

export type AwaitSuspension = {
  runId: string;
  workflowName: string;
  definitionPath: string;
  stepId: string;
  event: string;
  matchField: string;
  matchValue: AwaitMatchScalar;
  suspendedAt: string;
  awaitTimeoutMs?: number;
  deadlineAtMs?: number;
};

/**
 * On-disk record of a delivered event (or a fired timeout). Producers external
 * to the daemon write this file during a daemon-down gap; the live executor
 * also writes it so a crash between match and run-record still resumes from
 * the captured payload rather than re-subscribing.
 */
export type AwaitDelivery =
  | {
      kind: "event";
      deliveredAt: string;
      event: string;
      payload: Record<string, unknown>;
    }
  | {
      kind: "timeout";
      deliveredAt: string;
      event: string;
      awaitTimeoutMs: number;
    };

const AWAITS_SUBDIR = "awaits";

function awaitsDir(runDir: string): string {
  return join(runDir, AWAITS_SUBDIR);
}

function suspensionPath(runDir: string, stepId: string): string {
  return join(awaitsDir(runDir), `${stepId}.json`);
}

function deliveryPath(runDir: string, stepId: string): string {
  return join(awaitsDir(runDir), `${stepId}.delivered.json`);
}

export function writeSuspension(runDir: string, suspension: AwaitSuspension): void {
  mkdirSync(awaitsDir(runDir), { recursive: true });
  writeFileSync(
    suspensionPath(runDir, suspension.stepId),
    `${JSON.stringify(suspension, null, 2)}\n`,
    "utf-8",
  );
}

export function readSuspension(
  runDir: string,
  stepId: string,
): AwaitSuspension | null {
  return readOptionalJsonFile<AwaitSuspension>(suspensionPath(runDir, stepId));
}

export function deleteSuspension(runDir: string, stepId: string): void {
  rmSync(suspensionPath(runDir, stepId), { force: true });
}

export function writeDelivery(
  runDir: string,
  stepId: string,
  delivery: AwaitDelivery,
): void {
  mkdirSync(awaitsDir(runDir), { recursive: true });
  writeFileSync(
    deliveryPath(runDir, stepId),
    `${JSON.stringify(delivery, null, 2)}\n`,
    "utf-8",
  );
}

export function readDelivery(runDir: string, stepId: string): AwaitDelivery | null {
  return readOptionalJsonFile<AwaitDelivery>(deliveryPath(runDir, stepId));
}

export function deleteDelivery(runDir: string, stepId: string): void {
  rmSync(deliveryPath(runDir, stepId), { force: true });
}

export type ScannedSuspension = {
  suspension: AwaitSuspension;
  /** Absolute path of the run directory containing this suspension. */
  runDir: string;
  /** Pre-loaded delivery sibling, if a producer or live match persisted one. */
  delivery: AwaitDelivery | null;
};

/**
 * Walk `<runsRoot>/*\/awaits/*.json` and return every persisted suspension
 * with its (optional) delivery sibling. Used at runtime startup to drive
 * resume queueing.
 */
export function scanSuspensions(runsRoot: string): ScannedSuspension[] {
  if (!existsSync(runsRoot)) return [];
  const out: ScannedSuspension[] = [];
  for (const runDirName of readdirSync(runsRoot)) {
    const runDir = join(runsRoot, runDirName);
    const dir = awaitsDir(runDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".json") || entry.endsWith(".delivered.json")) continue;
      const stepId = entry.slice(0, -".json".length);
      const suspension = readSuspension(runDir, stepId);
      if (!suspension) continue;
      const delivery = readDelivery(runDir, stepId);
      out.push({ suspension, runDir, delivery });
    }
  }
  return out;
}

/**
 * Removes the suspension and any delivery sibling for the given step. Used by
 * the live executor on clean resolve and by the resume queueing path once it
 * has consumed a delivery.
 */
export function clearAwaitFiles(runDir: string, stepId: string): void {
  deleteSuspension(runDir, stepId);
  deleteDelivery(runDir, stepId);
}
