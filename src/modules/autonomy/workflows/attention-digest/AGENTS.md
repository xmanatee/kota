# Attention Digest Workflow

This directory contains the attention digest workflow definition and test.

- The workflow reacts to a small set of explicit attention-worthy events plus failed/interrupted queue workflows.
- Any `workflow.completed` trigger here must stay filtered so it cannot match the digest workflow's own completion.
- The runtime validates this: any `workflow.completed` trigger that can match its own completion payload is a hard validation error.

## On-Demand Seam

`renderOnDemandAttention({ scopeRoot, runsDir, authority })` in `step.ts` runs the same
detector + renderer the cadence path uses and returns
`{ items: AttentionItem[]; text: string }`. The cadence step
calls the same seam so the two paths cannot drift. Operator-facing pull
surfaces such as Telegram, Slack, CLI, daemon HTTP, embedded web, macOS, and
mobile should consume this seam directly and pass canonical workflow-run
authority rather than deriving it from the run-artifact directory.

Provider arm: unlike the recall, answer, and voice surfaces, attention has no
semantic provider seam — the body is deterministic over local task state and
run history. It does require the daemon's canonical workflow authority. The
route returns 503 when that authority is unavailable, success (200) when it can
render, and a defensive fallback (500) for read failures. New attention client
surfaces should strict-decode `{ data: { items }, text }` and surface transport
errors as plain failure banners.

Counter invariant: the cadence counter is revisioned project state owned by
the workflow runtime. The cadence run stages its update transactionally;
on-demand reads do not advance it or change the next cadence boundary.

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
