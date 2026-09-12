import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { writeJsonFileAtomic } from "#core/util/json-file.js";

export type ConversationLock = (() => void) & { quarantine(reason: string, executionId?: string): void; confirmNativeStop(): void };

/**
 * SQLite holds the OS lock for the invocation's lifetime, including across
 * independent CLI hosts. A crashed process releases it without stale-PID or
 * timeout-based takeover. A durable pending native-stop record prevents reuse
 * after a crash. Never unlink lock files: replacing an inode would let two hosts
 * lock different files.
 */
export function acquireConversationLock(storeRoot: string, identity: readonly string[]): ConversationLock {
  const directory = join(storeRoot, "locks");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  const path = join(directory, `${key}.sqlite`);
  const unresolvedStopPath = join(directory, `${key}.unresolved-stop.json`);
  const database = lockDatabase(path);
  try {
    if (existsSync(unresolvedStopPath)) {
      const fence = nativeStopSchema.parse(JSON.parse(readFileSync(unresolvedStopPath, "utf8")) as unknown);
      throw new Error(`The agent conversation has an unresolved native stop (${fence.executionId}). Resume and reset remain disabled. After verifying that all prior local and provider execution stopped, an operator can run kota history recover-native --scope-root <scope> --execution-id ${fence.executionId} --confirm-stopped --evidence <file>. Evidence: ${unresolvedStopPath}`);
    }
  } catch (error) {
    database.close();
    throw error;
  }
  return Object.assign(() => { if (database.open) database.close(); }, {
    confirmNativeStop() {
      if (!database.open) throw new Error("Cannot confirm native stop after conversation ownership release.");
      rmSync(unresolvedStopPath, { force: true });
    },
    quarantine(reason: string, executionId = randomUUID()) {
      if (!database.open) throw new Error("Cannot quarantine after conversation ownership release.");
      // Written under the OS lock; unlike that lock, uncertainty about remote
      // execution must survive this host's exit. Never expire or reset it.
      writeJsonFileAtomic(unresolvedStopPath, { reason, executionId, identity }, undefined, { mode: 0o600 });
    },
  });
}

const nativeStopSchema = z.object({ executionId: z.uuid(), reason: z.string(), identity: z.array(z.string()) }).strict();

function lockDatabase(path: string): Database.Database {
  const database = new Database(path, { timeout: 0 });
  try {
    chmodSync(path, 0o600);
    database.exec("BEGIN EXCLUSIVE");
    return database;
  } catch (error) {
    database.close();
    if (error instanceof Database.SqliteError && error.code === "SQLITE_BUSY") {
      throw new Error("The agent conversation already has an active owner. Stop the active conversation before resetting or resuming it.");
    }
    throw error;
  }
}

/** Host-local operator attestation, never an agent-run option or timeout takeover. */
export function recoverNativeConversationStop(storeRoot: string, input: {
  executionId: string;
  confirmedStopped: boolean;
  evidence: string;
}): { recoveredLocks: number; evidencePath: string } {
  const executionId = z.uuid().parse(input.executionId);
  if (!input.confirmedStopped || !input.evidence.trim()) {
    throw new Error("Native recovery requires explicit confirmation that local and provider execution stopped, with nonempty stop evidence.");
  }
  const directory = join(storeRoot, "locks");
  const candidates = existsSync(directory) ? readdirSync(directory)
    .filter((name) => /^[a-f0-9]{64}\.unresolved-stop\.json$/.test(name))
    .flatMap((name) => {
      const path = join(directory, name);
      let value: unknown;
      try { value = JSON.parse(readFileSync(path, "utf8")); }
      catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return [];
        throw error;
      }
      const parsed = nativeStopSchema.safeParse(value);
      return parsed.success && parsed.data.executionId === executionId ? [{ path, name, fence: parsed.data }] : [];
    }) : [];
  if (candidates.length === 0) throw new Error("No unresolved native stop matches this execution in the selected scope.");
  const locks: Database.Database[] = [];
  try {
    // Acquire every owner/identity before changing any exclusion. An active host
    // can still checkpoint new identities; its owner lock prevents this recovery.
    for (const candidate of candidates.sort((a, b) => a.name.localeCompare(b.name))) {
      locks.push(lockDatabase(join(directory, candidate.name.replace(".unresolved-stop.json", ".sqlite"))));
    }
    for (const candidate of candidates) {
      const current = nativeStopSchema.parse(JSON.parse(readFileSync(candidate.path, "utf8")) as unknown);
      if (current.executionId !== executionId) throw new Error("Native stop changed during recovery; inspect the current execution before confirming stop.");
    }
    const evidencePath = join(directory, `recovered-${executionId}-${randomUUID()}.json`);
    // Retain the assertion and original exclusions before clearing them. Partial
    // recovery after a crash is retryable with the same execution identity.
    writeJsonFileAtomic(evidencePath, {
      executionId, confirmedStopped: true, evidence: input.evidence,
      confirmedAt: new Date().toISOString(),
      exclusions: candidates.map(({ name, fence }) => ({ name, ...fence })),
    }, undefined, { mode: 0o600 });
    for (const candidate of candidates) rmSync(candidate.path);
    return { recoveredLocks: candidates.length, evidencePath };
  } finally {
    for (const database of locks) database.close();
  }
}
