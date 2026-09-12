import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { acquireConversationLock, type ConversationLock } from "./conversation-lock.js";
import { harnessSupportsRunOption } from "./run-option-routing.js";
import type { AgentHarness, AgentHarnessRunOptions } from "./types.js";

/** Only proven session loss permits a successor. Auth, quota and transport errors do not. */
export class SessionRecoveryError extends Error {}

const checkpointSchema = z.object({
  version: z.literal(1),
  owner: z.string(),
  harness: z.string(),
  cwd: z.string(),
  model: z.string().optional(),
  sessionId: z.string().optional(),
  generation: z.number().int().nonnegative().default(0),
  disposition: z.enum(["preserved", "explicit-discard", "unsupported", "successor"]),
  reason: z.string().optional(),
}).strict();

export function agentConversationRoot(scopeRoot: string): string {
  return join(resolve(scopeRoot), ".kota", "openai-tools-agent-harness", "sessions");
}

/** A caller requested recovery of work that has never been preserved in this scope. */
export class ConversationNotFoundError extends Error {}

export function requireAgentConversation(scopeRoot: string, owner: string): void {
  const key = createHash("sha256").update(owner).digest("hex");
  const path = join(agentConversationRoot(scopeRoot), "owners", key, "continuity.json");
  if (!existsSync(path)) throw new ConversationNotFoundError("Session not found");
  const checkpoint = checkpointSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  if (checkpoint.owner !== owner) throw new Error("The conversation checkpoint has incompatible ownership; its evidence was retained.");
}

/** The conversation store owns identity checkpoints as well as provider transcripts. */
export function prepareSessionContinuity(harness: Pick<AgentHarness, "name" | "unsupportedRunOptions">, options: AgentHarnessRunOptions, seedConversation?: (prompt: string) => string): {
  options: AgentHarnessRunOptions;
  /** No preserved lineage exists yet; an explicit legacy source may seed it. */
  isNewConversation: boolean;
  recover(error: SessionRecoveryError): Pick<AgentHarnessRunOptions, "resumeSessionId" | "sessionStorageDir" | "prompt">;
  beginNativeExecution(): void;
  confirmNativeStop(): void;
  quarantine(error: Error): void;
  release(): void;
} {
  const scopeRoot = resolve(options.scopeRoot ?? options.cwd ?? process.cwd());
  let owner = options.continuityKey ?? (options.resumeSessionId === undefined
    ? options.sessionContext?.sessionId ?? `invocation:${randomUUID()}`
    : `resume:${harness.name}:${options.resumeSessionId}`);
  // An explicit transfer/resume uses the original storage, never a global latest session.
  if (options.resumeSessionId !== undefined) {
    const existingOwner = findAgentConversationOwner(scopeRoot, harness.name, options.resumeSessionId);
    if (existingOwner !== undefined) {
      if (options.continuityKey !== undefined && options.continuityKey !== existingOwner) throw new Error("Explicit resume belongs to different work; use the authorized handoff contract.");
      owner = existingOwner;
    }
  }
  const key = createHash("sha256").update(owner).digest("hex");
  const directory = join(agentConversationRoot(scopeRoot), "owners", key);
  const path = join(directory, "continuity.json");
  const releaseOwner = acquireConversationLock(agentConversationRoot(scopeRoot), ["owner", owner]);
  const sessionLocks = new Map<string, ConversationLock>();
  let unresolvedStop: Error | undefined;
  let nativeExecutionPending = false;
  let nativeExecutionId = randomUUID();
  const pendingReason = "Native execution was admitted but its stop has not been confirmed.";
  const lockSession = (id: string) => {
    if (!sessionLocks.has(id)) {
      const lock = acquireConversationLock(agentConversationRoot(scopeRoot), ["session", harness.name, id]);
      sessionLocks.set(id, lock);
      if (unresolvedStop !== undefined) lock.quarantine(unresolvedStop.message, nativeExecutionId);
      else if (nativeExecutionPending) lock.quarantine(pendingReason, nativeExecutionId);
    }
  };
  let released = false;
  const release = () => {
    released = true;
    for (const unlock of sessionLocks.values()) unlock();
    releaseOwner();
  };
  try {
    if (options.resumeSessionId !== undefined) lockSession(options.resumeSessionId);
    const previous = existsSync(path)
      ? checkpointSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown)
      : undefined;
    const isNewConversation = previous === undefined && options.resumeSessionId === undefined;
    if (isNewConversation && seedConversation !== undefined) {
      options = { ...options, prompt: seedConversation(options.prompt) };
    }
    if (previous?.sessionId !== undefined) lockSession(previous.sessionId);
    const cwd = resolve(options.cwd ?? scopeRoot);
    if (previous !== undefined && previous.owner !== owner) throw new Error("The conversation checkpoint has incompatible ownership; its evidence was retained.");
    const incompatible = previous !== undefined && (previous.harness !== harness.name || previous.cwd !== cwd || previous.model !== options.model);

    if (previous !== undefined && options.resumeSessionId !== undefined && previous.sessionId !== options.resumeSessionId) {
      // A completed step can still name an ancestor after an interrupted successor.
      // Only this work's retained lineage authorizes using the newer checkpoint.
      const isAncestor = options.continuityKey === owner && readdirSync(directory)
        .filter((name) => /^retired-\d+\.json$/.test(name))
        .some((name) => {
          const retired = checkpointSchema.parse(JSON.parse(readFileSync(join(directory, name), "utf8")) as unknown);
          return retired.owner === owner && retired.sessionId === options.resumeSessionId;
        });
      if (!isAncestor) throw new Error("Explicit resume does not match the conversation owned by this work.");
      options = { ...options, resumeSessionId: previous.sessionId };
    }
    const supported = harnessSupportsRunOption(harness, "persistSession") && harnessSupportsRunOption(harness, "resumeSessionId");
    const persist = options.persistSession !== false && supported;
    const record: z.infer<typeof checkpointSchema> = {
      version: 1, owner, harness: harness.name, cwd,
      generation: previous?.generation ?? 0,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...((previous?.sessionId ?? options.resumeSessionId) === undefined ? {} : { sessionId: previous?.sessionId ?? options.resumeSessionId }),
      disposition: options.persistSession === false ? "explicit-discard" : supported ? (previous?.disposition === "successor" ? "successor" : "preserved") : "unsupported",
      ...(previous?.reason === undefined ? {} : { reason: previous.reason }),
      ...(options.persistSession === false ? { reason: "Caller explicitly declined session preservation." } : {}),
      ...(!supported ? { reason: harness.unsupportedRunOptions?.filter((entry) => entry.runOption === "persistSession" || entry.runOption === "resumeSessionId").map((entry) => entry.reason).join(" ") } : {}),
    };
    const save = () => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeJsonFileAtomic(path, record, undefined, { mode: 0o600 });
    };
    if (options.persistSession === false && previous?.sessionId !== undefined) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeJsonFileAtomic(join(directory, `retired-${record.generation}.json`), { ...previous, disposition: "explicit-discard", reason: record.reason }, undefined, { mode: 0o600 });
      delete record.sessionId;
      record.generation += 1;
    }
    if (incompatible && previous !== undefined && options.persistSession !== false) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const reason = "The current harness, workspace, or model differs from the preserved conversation. Original session evidence is retained.";
      writeJsonFileAtomic(join(directory, `retired-${previous.generation}.json`), { ...previous, reason }, undefined, { mode: 0o600 });
      record.generation = previous.generation + 1;
      record.disposition = "successor";
      record.reason = reason;
      delete record.sessionId;
      options = { ...options, resumeSessionId: undefined, prompt: `This is a successor conversation: ${reason} Inspect saved work before acting; do not replay ambiguous effects.\n\n${options.prompt}` };
    }
    const storage = () => join(directory, `provider-${record.generation}`);
    save();
    const onSessionId = (id: string): void => {
      if (released) return;
      if (!id.trim()) throw new Error("The adapter reported an empty resumable session identity.");
      lockSession(id);
      if (!persist) { options.onSessionId?.(id); return; }
      if (record.sessionId !== undefined && record.sessionId !== id) throw new Error("The adapter changed a preserved conversation identity without a recovery disposition.");
      if (record.sessionId !== id) { record.sessionId = id; save(); }
      options.onSessionId?.(id);
    };
    return {
      isNewConversation,
      options: {
        ...options,
        continuityKey: owner,
        ...((persist && (options.resumeSessionId ?? record.sessionId) !== undefined) ? { prompt: `Continue the preserved conversation using current instructions and policy. Inspect saved work before acting; an interrupted tool may have had effects whose result was not recorded. Do not blindly replay effects. Conversation context is restored, not a process instruction pointer.\n\n${options.prompt}` } : {}),
        ...(supported ? { persistSession: persist } : {}),
        ...(options.persistSession === false ? { resumeSessionId: undefined } : {}),
        ...(persist && options.resumeSessionId === undefined && record.sessionId !== undefined ? { resumeSessionId: record.sessionId } : {}),
        sessionStorageDir: storage(),
        onSessionId,
      },
      recover(error) {
        writeJsonFileAtomic(join(directory, `retired-${record.generation}.json`), { ...record, reason: error.message }, undefined, { mode: 0o600 });
        delete record.sessionId;
        record.generation += 1;
        record.disposition = "successor";
        record.reason = error.message;
        save();
        return {
          resumeSessionId: undefined,
          sessionStorageDir: storage(),
          prompt: `The prior conversation could not be recovered: ${error.message}\nThis is a successor conversation. Saved work and evidence remain available. Inspect them before acting; do not replay ambiguous external effects. No process instruction pointer was restored.\n\n${options.prompt}`,
        };
      },
      beginNativeExecution() {
        nativeExecutionId = randomUUID();
        nativeExecutionPending = true;
        // Persist before dispatch: OS-lock release on host death cannot establish
        // settlement of either a surviving subprocess or provider-owned work.
        releaseOwner.quarantine(pendingReason, nativeExecutionId);
        for (const lock of sessionLocks.values()) lock.quarantine(pendingReason, nativeExecutionId);
      },
      confirmNativeStop() {
        if (unresolvedStop !== undefined) throw unresolvedStop;
        for (const lock of sessionLocks.values()) lock.confirmNativeStop();
        releaseOwner.confirmNativeStop();
        nativeExecutionPending = false;
      },
      quarantine(error) {
        unresolvedStop = error;
        releaseOwner.quarantine(error.message, nativeExecutionId);
        for (const lock of sessionLocks.values()) lock.quarantine(error.message, nativeExecutionId);
      },
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** Explicit operator reset retires identity while retaining the original provider evidence. */
export function resetAgentConversation(scopeRoot: string, owner: string, reason: string): void {
  if (!reason.trim()) throw new Error("A conversation reset requires a reason.");
  const key = createHash("sha256").update(owner).digest("hex");
  const directory = join(agentConversationRoot(scopeRoot), "owners", key);
  const path = join(directory, "continuity.json");
  const release = acquireConversationLock(agentConversationRoot(scopeRoot), ["owner", owner]);
  let releaseSession: (() => void) | undefined;
  try {
    if (!existsSync(path)) return;
    const previous = checkpointSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
    if (previous.sessionId !== undefined) releaseSession = acquireConversationLock(agentConversationRoot(scopeRoot), ["session", previous.harness, previous.sessionId]);
    writeJsonFileAtomic(join(directory, `retired-${previous.generation}.json`), { ...previous, disposition: "explicit-discard", reason }, undefined, { mode: 0o600 });
    const next = { ...previous, generation: previous.generation + 1, disposition: "explicit-discard" as const, reason };
    delete next.sessionId;
    writeJsonFileAtomic(path, next, undefined, { mode: 0o600 });
  } finally {
    releaseSession?.();
    release();
  }
}

/** One bounded recovery attempt shared by harness and directly hosted delegate loops. */
export async function runWithSessionRecovery<T>(
  continuity: ReturnType<typeof prepareSessionContinuity>,
  options: AgentHarnessRunOptions,
  invoke: (options: AgentHarnessRunOptions) => Promise<T>,
  beforeRecovery: () => Promise<void> = async () => {},
): Promise<T> {
  try {
    return await invoke(options);
  } catch (error) {
    options.abortController?.signal.throwIfAborted();
    if (!(error instanceof SessionRecoveryError) || options.resumeSessionId === undefined) throw error;
    await beforeRecovery();
    return invoke({ ...options, ...continuity.recover(error) });
  }
}

/** Resolve only an explicitly named conversation; interactive resume also uses its reset owner. */
export function findAgentConversationOwner(scopeRoot: string, harness: string, sessionId: string): string | undefined {
  const ownersRoot = join(agentConversationRoot(scopeRoot), "owners");
  if (!existsSync(ownersRoot)) return undefined;
  for (const entry of readdirSync(ownersRoot)) {
    const path = join(ownersRoot, entry, "continuity.json");
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    let value: unknown;
    try { value = JSON.parse(source); }
    catch (error) {
      // Discovery must not let an unrelated damaged record hide a healthy
      // conversation. Keep the original file; direct owner reads still reject it.
      if (error instanceof SyntaxError) continue;
      throw error;
    }
    const parsed = checkpointSchema.safeParse(value);
    if (parsed.success && parsed.data.harness === harness && parsed.data.sessionId === sessionId) return parsed.data.owner;
  }
  return undefined;
}
