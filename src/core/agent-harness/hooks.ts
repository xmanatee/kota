/**
 * Harness-neutral lifecycle hooks.
 *
 * Modules register hooks against the harness boundary — the same place every
 * `AgentHarness.run()` call passes through. This is distinct from
 * `src/core/loop/pre-send-hooks.ts`, which owns hooks that run inside the
 * classic `AgentSession` loop and pass classic-loop primitives (ModelClient,
 * message history, CostTracker). Harness-boundary hooks fire for every adapter
 * that declares support for the hook's kind.
 */

import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "./types.js";

export type HarnessHookKind = "preRun" | "postRun";

export type PreRunHookContext = {
  harness: AgentHarness;
  options: AgentHarnessRunOptions;
};

export type PostRunHookContext = PreRunHookContext & {
  result: AgentHarnessResult;
};

export type PreRunHook = (ctx: PreRunHookContext) => Promise<void> | void;
export type PostRunHook = (ctx: PostRunHookContext) => Promise<void> | void;

type Handler<K extends HarnessHookKind> = K extends "preRun"
  ? PreRunHook
  : PostRunHook;

type HookEntry<K extends HarnessHookKind = HarnessHookKind> = {
  owner: string;
  name: string;
  handler: Handler<K>;
};

const registry: { [K in HarnessHookKind]: HookEntry<K>[] } = {
  preRun: [],
  postRun: [],
};

export type HarnessHookRegistration =
  | { kind: "preRun"; owner: string; name: string; handler: PreRunHook }
  | { kind: "postRun"; owner: string; name: string; handler: PostRunHook };

export function registerHarnessHook(registration: HarnessHookRegistration): void {
  const kind = registration.kind;
  const list = registry[kind];
  if (!list) {
    throw new Error(`Unknown harness hook kind: "${String(kind)}"`);
  }
  if (list.some((e) => e.owner === registration.owner && e.name === registration.name)) {
    throw new Error(
      `Harness hook already registered: kind=${kind} owner="${registration.owner}" name="${registration.name}"`,
    );
  }
  if (kind === "preRun") {
    registry.preRun.push({
      owner: registration.owner,
      name: registration.name,
      handler: registration.handler,
    });
  } else {
    registry.postRun.push({
      owner: registration.owner,
      name: registration.name,
      handler: registration.handler,
    });
  }
}

export function removeHarnessHooks(owner: string): void {
  for (const kind of Object.keys(registry) as HarnessHookKind[]) {
    const list = registry[kind];
    let i = list.length - 1;
    while (i >= 0) {
      if (list[i]?.owner === owner) list.splice(i, 1);
      i -= 1;
    }
  }
}

export function resetHarnessHooks(): void {
  for (const kind of Object.keys(registry) as HarnessHookKind[]) {
    registry[kind].length = 0;
  }
}

export function listHarnessHooks<K extends HarnessHookKind>(
  kind: K,
): ReadonlyArray<HookEntry<K>> {
  return [...registry[kind]] as HookEntry<K>[];
}

export function hasHarnessHooks(kind: HarnessHookKind): boolean {
  return registry[kind].length > 0;
}

export const ALL_HARNESS_HOOK_KINDS: readonly HarnessHookKind[] = ["preRun", "postRun"];
