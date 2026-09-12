import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  type OwnedProcessIdentity,
  type ProcessCleanupCommand,
  type ProcessResourceIdentity,
  type ProcessSpawnObserver,
  ProcessSupervisor,
} from "./process-supervisor.js";

const resourceSchema = z
  .object({
    kind: z.literal("resource"),
    key: z.string().uuid(),
    cleanup: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("command"),
          command: z.string().min(1),
          args: z.array(z.string()),
          absentMessage: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("directory"),
          path: z.string().refine((path) => isAbsolute(path) && path !== "/"),
        })
        .strict(),
    ]),
  })
  .strict();
export function parseProcessResource(value: unknown): ProcessResourceIdentity {
  return resourceSchema.parse(value);
}
const owner = new AsyncLocalStorage<ProcessSpawnObserver>();

/** Register before launching a resource whose lifetime is independent of its CLI. */
export function registerOwnedProcessResource(
  cleanup: ProcessCleanupCommand,
): void {
  const register = owner.getStore();
  if (register)
    register(
      parseProcessResource({ kind: "resource", key: randomUUID(), cleanup }),
    );
}

export function withOwnedProcessResources<T>(
  register: ProcessSpawnObserver,
  run: () => T,
): T {
  return owner.run(register, run);
}

/** Drain independent owners fairly, retaining the caller until every stop is proven.
 * Early resource removal can unblock a client, but cannot prove final absence:
 * clients may create resources until they stop. Confirm removal again only after
 * the worker and every registered process have stopped. */
export async function drainOwnedProcesses(
  identities: readonly OwnedProcessIdentity[],
  workerStopped: () => boolean,
): Promise<void> {
  while (true) {
    const stopped = workerStopped();
    const cohort = [...identities];
    const outcomes = await Promise.allSettled(cohort.map(async (identity) => {
      if ("kind" in identity) {
        await ProcessSupervisor.cleanupResource(identity.cleanup);
      } else {
        const outcome = await ProcessSupervisor.terminateOwnedProcess(identity, 1000);
        if (outcome.status !== "terminated" && outcome.status !== "not-running") {
          throw new Error(`Process ${identity.pid} retains ownership: ${outcome.status}`);
        }
      }
    }));
    const failures = outcomes.filter((outcome) => outcome.status === "rejected");
    if (stopped && cohort.length === identities.length && failures.length === 0) {
      // The first sweep may have observed absence before a client finished
      // creating its resource. All producers are now stopped, so only this
      // final resource sweep can release invocation ownership.
      const finalOutcomes = await Promise.allSettled(cohort.flatMap((identity) =>
        "kind" in identity ? [ProcessSupervisor.cleanupResource(identity.cleanup)] : []
      ));
      failures.push(...finalOutcomes.filter((outcome) => outcome.status === "rejected"));
      if (failures.length === 0) return;
    }
    for (const failure of failures) {
      process.stderr.write(`Owned execution cleanup pending: ${String(failure.reason)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, failures.length ? 1000 : 50));
  }
}
