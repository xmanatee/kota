# Attention Digest Workflow

This directory contains the attention digest workflow definition and test.

- The workflow reacts to a small set of explicit attention-worthy events plus failed/interrupted queue workflows.
- Any `workflow.completed` trigger here must stay filtered so it cannot match the digest workflow's own completion.
- The runtime validates this: any `workflow.completed` trigger that can match its own completion payload is a hard validation error.

## On-Demand Seam

`renderOnDemandAttention({ projectDir, runsDir })` in `step.ts` runs the same
detector + renderer the cadence path uses and returns
`{ items: AttentionItem[]; text: string }`. The cadence step
calls the same seam so the two paths cannot drift. Operator-facing pull
surfaces such as Telegram, CLI, daemon HTTP, embedded web, macOS, and mobile
should consume this seam directly.

Counter invariant: the on-demand path must not write
`<runsDir>/../attention-digest-counter.json`. That file is owned by the
cadence step and reflects "cycles since the last cadence-driven evaluation";
an on-demand call would corrupt the next cadence trigger boundary.

Bus invariant: the on-demand path must not emit `workflow.attention.digest`.
Other notification channels (Slack, email, webhook) must not see an operator's
mid-cycle `/attention` as a duplicate cadence digest; the requesting Telegram
chat receives the rendered text in-band.

No-items reply: when `detectAttentionItems` returns nothing, the on-demand
body is `NO_ATTENTION_ITEMS_TEXT` (a short fixed reply) rather than the
cadence-style header with an empty bullet list, so an operator can
distinguish "nothing wrong" from "command failed".

Quiet-hours invariant: quiet hours do not gate the on-demand path. The
operator initiated the request, so the runtime quiet-hours rule that buffers
cadence pushes does not apply.

Agent-feed invariant: like the cadence path, the on-demand body is
operator-facing only and must not be exposed to autonomy agents in any prompt
path (see project memory: no cost bias in autonomy).
