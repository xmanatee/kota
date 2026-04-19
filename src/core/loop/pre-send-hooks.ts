/**
 * Pre-send hook registry — module-owned callbacks that run once before the
 * main agent iteration loop starts for a given send.
 *
 * Modules register a hook via ctx.registerPreSendHook(name, fn). On every
 * send, loop-send.ts calls runPreSendHooks() in registration order. Each
 * hook may return a PreSendResult with optional fields that the loop
 * applies: `modifiedFiles` feed the verify tracker, `assistantText` and
 * `userFollowup` append to the context, and `lastResult` becomes the
 * returned text for the turn.
 *
 * This decouples the core loop from capability modules like architect-mode
 * that perform their own planning/execution pass before the normal turn
 * loop begins.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "#core/model/model-client.js";
import type { CostTracker } from "./cost.js";
import type { Transport } from "./transport.js";

export type PreSendContext = {
  client: ModelClient;
  model: string;
  editorModel: string;
  maxTokens: number;
  effectiveMaxTokens: number;
  systemContext: string;
  messages: Anthropic.Messages.MessageParam[];
  costTracker: CostTracker;
  verbose: boolean;
  thinkingConfig?: Anthropic.Messages.ThinkingConfigParam;
  transport: Transport;
};

export type PreSendResult = {
  lastResult?: string;
  assistantText?: string;
  userFollowup?: string;
  modifiedFiles?: readonly string[];
};

export type PreSendHook = (ctx: PreSendContext) => Promise<PreSendResult | null>;

type HookEntry = { owner: string; name: string; fn: PreSendHook };

const hooks: HookEntry[] = [];

export function registerPreSendHook(owner: string, name: string, fn: PreSendHook): void {
  if (hooks.some((h) => h.name === name)) {
    throw new Error(`Pre-send hook already registered: "${name}"`);
  }
  hooks.push({ owner, name, fn });
}

export function removePreSendHooks(owner: string): void {
  let i = hooks.length - 1;
  while (i >= 0) {
    if (hooks[i]?.owner === owner) hooks.splice(i, 1);
    i -= 1;
  }
}

export function resetPreSendHooks(): void {
  hooks.length = 0;
}

export async function runPreSendHooks(ctx: PreSendContext): Promise<PreSendResult[]> {
  const results: PreSendResult[] = [];
  for (const h of hooks) {
    const r = await h.fn(ctx);
    if (r) results.push(r);
  }
  return results;
}
