import { createHash } from "node:crypto";
import type { ProcessIdentity } from "#core/execution/process-supervisor.js";
import type { RunResourceProfile } from "./run-resources.js";
import type { RunSandbox } from "./run-sandbox.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";

export type DurableEffectValue =
  | null
  | boolean
  | number
  | string
  | readonly DurableEffectValue[]
  | { readonly [key: string]: DurableEffectValue };

export type DurableExternalEffectInput<T extends DurableEffectValue> = {
  key: string;
  requestFingerprint: string;
  execute: () => Promise<T>;
};

export type DurableExternalEffects = {
  execute<T extends DurableEffectValue>(
    input: DurableExternalEffectInput<T>,
  ): Promise<T>;
};

export type TransactionalRunPublications = Readonly<{
  stageEmit(
    stepId: string,
    event: string,
    payload: Readonly<Record<string, unknown>>,
  ): void;
}>;

export type RunStateValueSnapshot<T extends DurableEffectValue> = Readonly<{
  revision: number;
  value: T | null;
}>;

export type TransactionalRunState = Readonly<{
  read<T extends DurableEffectValue>(key: string): RunStateValueSnapshot<T>;
  compareAndSet<T extends DurableEffectValue>(
    key: string,
    expectedRevision: number,
    value: T,
  ): void;
}>;

function canonicalJson(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("External effect requests must contain only finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error("External effect requests must not be cyclic");
    seen.add(value);
    try {
      return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error("External effect requests must not be cyclic");
    seen.add(object);
    try {
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key], seen)}`)
        .join(",")}}`;
    } finally {
      seen.delete(object);
    }
  }
  throw new Error(
    `External effect requests must be JSON values, received ${typeof value}`,
  );
}

/** Stable identity for a declarative tool request, independent of object key order. */
export function fingerprintToolEffectRequest(
  tool: string,
  input: Record<string, unknown>,
): string {
  if (!tool.trim()) throw new Error("External effect tool name must not be empty");
  return createHash("sha256")
    .update(canonicalJson({ input, tool }, new Set()))
    .digest("hex");
}

export type RunProcessRegistry = Readonly<{
  register(identity: ProcessIdentity): void;
}>;

export class AmbiguousExternalEffectError extends Error {
  constructor(
    readonly effectKey: string,
    options?: ErrorOptions,
  ) {
    super(
      `External effect "${effectKey}" may have happened; automatic replay is unsafe`,
      options,
    );
    this.name = "AmbiguousExternalEffectError";
  }
}

export type RunContext = Readonly<{
  run: Readonly<{
    id: string;
    attempt: number;
    daemonEpoch: number;
  }>;
  project: Readonly<{
    id: string;
    root: string;
  }>;
  workflow: string;
  trigger: WorkflowRunTrigger;
  sandbox: Readonly<RunSandbox>;
  resources: RunResourceProfile;
  signal: AbortSignal;
  processes: RunProcessRegistry;
  effects: DurableExternalEffects;
  publications: TransactionalRunPublications;
  state: TransactionalRunState;
}>;

type CreateRunContextInput = {
  runId: string;
  attempt: number;
  daemonEpoch: number;
  projectId: string;
  projectRoot: string;
  workflow: string;
  trigger: WorkflowRunTrigger;
  sandbox: RunSandbox;
  resources: RunResourceProfile;
  signal: AbortSignal;
  store: RunStateDatabase;
  now: () => string;
};

function assertEffectIdentity(key: string, requestFingerprint: string): void {
  if (!key.trim()) throw new Error("External effect key must not be empty");
  if (!requestFingerprint.trim()) {
    throw new Error("External effect request fingerprint must not be empty");
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createRunContext(input: CreateRunContextInput): RunContext {
  const processes: RunProcessRegistry = Object.freeze({
    register(identity: ProcessIdentity): void {
      input.store.registerAttemptProcess({
        runId: input.runId,
        epoch: input.daemonEpoch,
        processKey: `${identity.pid}:${identity.osStartToken}`,
        identity: { ...identity },
        registeredAt: input.now(),
      });
    },
  });
  const effects: DurableExternalEffects = Object.freeze({
    async execute<T extends DurableEffectValue>(
      effect: DurableExternalEffectInput<T>,
    ): Promise<T> {
      assertEffectIdentity(effect.key, effect.requestFingerprint);
      const effectKey = `${input.runId}:${effect.key}`;
      const preparation = input.store.prepareExternalEffect({
        key: effectKey,
        runId: input.runId,
        requestFingerprint: effect.requestFingerprint,
        preparedAt: input.now(),
      });
      if (preparation.disposition === "completed") {
        return preparation.result as T;
      }
      if (preparation.disposition === "ambiguous") {
        throw new AmbiguousExternalEffectError(effectKey);
      }

      try {
        const result = await effect.execute();
        input.store.completeExternalEffect({
          key: effectKey,
          runId: input.runId,
          completedAt: input.now(),
          result,
        });
        return result;
      } catch (error) {
        input.store.markExternalEffectUnknown(effectKey, input.runId);
        throw new AmbiguousExternalEffectError(effectKey, { cause: error });
      }
    },
  });
  const publications: TransactionalRunPublications = Object.freeze({
    stageEmit(
      stepId: string,
      event: string,
      payload: Readonly<Record<string, unknown>>,
    ): void {
      input.store.stageEmitIntent({
        runId: input.runId,
        stepId,
        event,
        payload,
        stagedAt: input.now(),
      });
    },
  });
  const state: TransactionalRunState = Object.freeze({
    read<T extends DurableEffectValue>(key: string): RunStateValueSnapshot<T> {
      const snapshot = input.store.readProjectStateValue<T>(input.projectId, key);
      return Object.freeze({
        revision: snapshot.revision,
        value: snapshot.value === null
          ? null
          : deepFreeze(structuredClone(snapshot.value)),
      });
    },
    compareAndSet<T extends DurableEffectValue>(
      key: string,
      expectedRevision: number,
      value: T,
    ): void {
      input.store.stageProjectStateMutation({
        runId: input.runId,
        key,
        expectedRevision,
        value,
        stagedAt: input.now(),
      });
    },
  });

  const sandbox = deepFreeze({ ...input.sandbox }) as Readonly<RunSandbox>;
  return Object.freeze({
    run: Object.freeze({
      id: input.runId,
      attempt: input.attempt,
      daemonEpoch: input.daemonEpoch,
    }),
    project: Object.freeze({ id: input.projectId, root: input.projectRoot }),
    workflow: input.workflow,
    trigger: deepFreeze(structuredClone(input.trigger)),
    sandbox,
    resources: input.resources,
    signal: input.signal,
    processes,
    effects,
    publications,
    state,
  });
}
