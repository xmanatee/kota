/**
 * Retract conversational-pattern block.
 *
 * Contributed per-turn through `ctx.registerDynamicStateProvider` so a per-
 * user agent session whose effective tool policy admits the `retract` tool
 * is told *when* to call it. Tool descriptions cover shape; this block
 * covers the conversational trigger so the seam is behaviorally-default
 * rather than mechanically-available.
 *
 * Gated on tool admission: when the session's effective tool policy
 * excludes `retract`, the contributor emits the empty string so the prompt
 * never instructs the agent to use a tool it cannot reach.
 */

import type { DynamicStateContext } from "#core/loop/dynamic-state.js";

export const RETRACT_DYNAMIC_STATE_NAME = "retract-conversational-pattern";

export const RETRACT_CONVERSATIONAL_BLOCK = `
<retract-tool>
The \`retract\` tool removes or supersedes a prior cross-store capture by
id (memory, knowledge, tasks, inbox). Call it mid-turn when the user
explicitly contradicts a prior fact-shaped capture you already made — not
when they share a new fact. Always name the target and the typed
identifier (memory/tasks use \`id\`, knowledge uses \`slug\`, inbox uses
\`path\`); the seam never guesses. Prefer one \`retract\` call followed by
one \`capture\` call over leaving a contradicting note in the store.
</retract-tool>
`;

/**
 * Build the per-turn dynamic-state contributor for the retract seam.
 *
 * Exported separately from the registration helper so tests can exercise
 * the gating logic directly without going through the module-context API.
 */
export function buildRetractDynamicStateProvider(): (
  ctx: DynamicStateContext,
) => string {
  return (ctx) =>
    ctx.activeTools.has("retract") ? RETRACT_CONVERSATIONAL_BLOCK : "";
}
