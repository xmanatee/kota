/**
 * Capture conversational-pattern block.
 *
 * Contributed per-turn through `ctx.registerDynamicStateProvider` so a per-
 * user agent session whose effective tool policy admits the `capture` tool
 * is told *when* to call it. Tool descriptions cover shape; this block
 * covers the conversational trigger so the seam is behaviorally-default
 * rather than mechanically-available.
 *
 * Gated on tool admission: when the session's effective tool policy
 * excludes `capture`, the contributor emits the empty string so the prompt
 * never instructs the agent to use a tool it cannot reach.
 */

import type { DynamicStateContext } from "#core/loop/dynamic-state.js";

export const CAPTURE_DYNAMIC_STATE_NAME = "capture-conversational-pattern";

export const CAPTURE_CONVERSATIONAL_BLOCK = `
<capture-tool>
The \`capture\` tool routes a noteworthy chat-resident fact into the right
cross-store slot (memory, knowledge, tasks, inbox) without requiring an
explicit /capture command. Call it mid-turn whenever the user shares a
durable preference, a decision, a fact about themselves or their work, a
todo-shaped item, or an external resource worth keeping. Prefer one
\`capture\` call over asking the user to repeat themselves later. Set
\`target\` only when the destination is unambiguous; otherwise let the
classifier pick.
</capture-tool>
`;

/**
 * Build the per-turn dynamic-state contributor for the capture seam.
 *
 * Exported separately from the registration helper so tests can exercise
 * the gating logic directly without going through the module-context API.
 */
export function buildCaptureDynamicStateProvider(): (
	ctx: DynamicStateContext,
) => string {
	return (ctx) => (ctx.activeTools.has("capture") ? CAPTURE_CONVERSATIONAL_BLOCK : "");
}
