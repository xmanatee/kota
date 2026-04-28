/**
 * Recall conversational-pattern block.
 *
 * Contributed per-turn through `ctx.registerDynamicStateProvider` so a per-
 * user agent session whose effective tool policy admits the `recall` tool
 * is told *when* to call it before answering a fact-shaped question. Tool
 * descriptions cover shape; this block covers the conversational trigger
 * so the seam is behaviorally-default rather than mechanically-available.
 *
 * Gated on tool admission: when the session's effective tool policy
 * excludes `recall`, the contributor emits the empty string so the prompt
 * never instructs the agent to use a tool it cannot reach.
 */

import type { DynamicStateContext } from "#core/loop/dynamic-state.js";

export const RECALL_DYNAMIC_STATE_NAME = "recall-conversational-pattern";

export const RECALL_CONVERSATIONAL_BLOCK = `
<recall-tool>
The \`recall\` tool searches the second brain (knowledge, memory,
conversation history, repo tasks, and the assistant's prior cited-answer
envelopes) for ranked, source-tagged hits. Call it before answering any
fact-shaped question whose answer plausibly lives in KOTA's stores
instead of free-styling from raw model knowledge. Use the returned hits
to ground the reply and cite them inline; an \`answer\`-source hit is a
prior synthesized reply for a similar query, so prefer reusing or
extending that answer over re-synthesizing from scratch when the question
matches. Skip recall only when the user is asking for raw computation,
code generation against provided context, or a question that obviously
has no second-brain grounding.
</recall-tool>
`;

/**
 * Build the per-turn dynamic-state contributor for the recall seam.
 *
 * Exported separately from the registration helper so tests can exercise
 * the gating logic directly without going through the module-context API.
 */
export function buildRecallDynamicStateProvider(): (
	ctx: DynamicStateContext,
) => string {
	return (ctx) => (ctx.activeTools.has("recall") ? RECALL_CONVERSATIONAL_BLOCK : "");
}
