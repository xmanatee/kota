---
status: done
---

# Add peer agent product benchmark matrix

## Problem

KOTA has accumulated many internal concepts, but it is not always obvious how
it objectively differs from peer agent systems or which external ideas should
be adopted. Without a bounded comparison process, research links become either
random inspiration or ignored inbox material.

## Desired Outcome

Create a recurring peer product benchmark matrix that compares KOTA against
selected external agent/runtime/security/knowledge projects and records
bounded adopt/adapt/reject/later decisions mapped to existing KOTA concepts.

## Constraints

- Use current external sources and cite them.
- At most three KOTA tasks may come from one review cycle.
- Every adopted idea must map to an existing KOTA concept: module, client,
  workflow, channel, tool, setup requirement, store, daemon, or scope.
- Do not create a new subsystem just because a peer project names one.

## Done When

- Matrix covers DOX, Agent Zero, Space Agent, ClawPatrol, Rowboat, Open
  Notebook, Headroom, OpenAI secure MCP tunnels, project-shaped workflow
  framing, and agent-computer patterns.
- Each row records capability, KOTA equivalent, gap, decision, and resulting
  bounded next action.
- External pattern decisions or watchlist entries are updated only for adopted
  or revisit-worthy ideas.

## Source / Intent

Owner supplied research links on 2026-06-11 and asked to understand which
external project capabilities matter for KOTA rather than blindly copying or
ignoring them.

The 2026-06-10 inbox research bundle already contained notes for those peer
systems plus project-first hiring and LangChain sandbox references. Its unread
bare-link tail is tracked separately in
`task-review-owner-captured-automated-research-and-mimo-`; its inaccessible X
post is tracked in `task-review-inaccessible-research-resources-when-access`.

## Initiative

KOTA external product benchmarking.

## Acceptance Evidence

- A benchmark artifact cites current source URLs and records adopt/adapt/reject
  decisions.
- Operator-facing transcript
  `.kota/runs/2026-06-19T05-46-54-721Z-builder-047rt8/operator-journey-transcript.txt`
  shows `kota task show` output for this Product task, the benchmark artifact
  excerpt, the bounded follow-up task, and task validation.
- Repair transcript
  `.kota/runs/2026-06-19T14-35-59-398Z-builder-vk6yp3/transcript.txt`
  shows the current `task show` output after the Product evidence backfill and
  the validation command passing.
- `pnpm validate-tasks` passes after any resulting tasks are created.
- No more than three new KOTA tasks are opened from the benchmark cycle.

## Outcome (2026-06-19)

Benchmark artifact:
`.kota/runs/2026-06-19T05-46-54-721Z-builder-047rt8/peer-agent-product-benchmark-matrix.md`.

Durable changes from the cycle:

- Added watchlist entries for Agent Zero, Space Agent, Rowboat, Open Notebook,
  and OpenAI Secure MCP Tunnel as recurring product signals.
- Opened one follow-up task,
  `task-add-private-mcp-tunnel-connector-support`, for the adopted private MCP
  tunnel gap.
- Left ClawPatrol and Headroom as later/no-action rows because current public
  source access did not provide enough primary content for honest adoption.
