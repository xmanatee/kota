/**
 * Answer conversational-pattern block.
 *
 * Contributed per-turn through `ctx.registerDynamicStateProvider` so a per-
 * user agent session whose effective tool policy admits the `answer` tool
 * is told *when* to prefer cited synthesis over free-form replies. Tool
 * descriptions cover shape; this block covers the conversational trigger
 * so the seam is behaviorally-default rather than mechanically-available.
 *
 * Gated on tool admission: when the session's effective tool policy
 * excludes `answer`, the contributor emits the empty string so the prompt
 * never instructs the agent to use a tool it cannot reach.
 */

import type { DynamicStateContext } from "#core/loop/dynamic-state.js";

export const ANSWER_DYNAMIC_STATE_NAME = "answer-conversational-pattern";

export const ANSWER_CONVERSATIONAL_BLOCK = `
<answer-tool>
The \`answer\` tool composes one short cited reply by running cross-store
recall and asking the model to synthesize a response with typed
\`[source:id]\` citations, appending one record to the answer history.
Prefer it over a free-form reply for any question that asks for a
synthesized answer grounded in the second brain — anything starting with
"what is", "how did we", "what do I think about", "summarize", or
"explain". Free-form replies should be reserved for raw computation,
code generation against provided context, or chat that does not require
grounding.
</answer-tool>
`;

/**
 * Build the per-turn dynamic-state contributor for the answer seam.
 *
 * Exported separately from the registration helper so tests can exercise
 * the gating logic directly without going through the module-context API.
 */
export function buildAnswerDynamicStateProvider(): (
	ctx: DynamicStateContext,
) => string {
	return (ctx) => (ctx.activeTools.has("answer") ? ANSWER_CONVERSATIONAL_BLOCK : "");
}
