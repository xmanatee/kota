---
id: task-gate-github-event-triggered-agent-runs-on-actor-integrity
title: Gate GitHub event-triggered agent runs on actor integrity
status: done
priority: p2
area: modules
summary: Add normalized actor and trust metadata to GitHub webhook events, then require event-triggered agent workflows such as pr-reviewer to prove the event came from an allowed repository actor before exposing PR content to an autonomous review step.
created_at: 2026-05-17T04:14:04Z
updated_at: 2026-05-17T04:26:20Z
---

## Problem

`github-webhook` validates GitHub's delivery HMAC and emits a normalized
`github.pull_request` payload, and `pr-reviewer` skips forks and non-`kota/task/*`
branches. That proves the event came through GitHub, but it does not prove that
the PR content came from an actor KOTA intended to trust for autonomous review.

The current normalized pull-request payload omits `sender`, PR author,
`author_association`, head SHA, and any explicit trust decision. An event-driven
agent workflow therefore cannot distinguish "KOTA-created branch updated by an
allowed actor" from "same-repo branch or metadata crafted by a low-trust actor"
except through branch naming and fork status.

Recent GitHub Agentic Workflows documentation makes this boundary concrete:
event-triggered repository agents need an author/content integrity layer, not
only webhook authenticity and prompt-injection labeling. KOTA already labels
trigger payload text as untrusted before agent prompt exposure; the remaining
gap is deciding whether the event-derived content should reach the agent at
all.

## Desired Outcome

GitHub event-triggered agent workflows can make a typed, auditable trust
decision before running an autonomous agent step. The GitHub webhook module
normalizes actor and integrity metadata from pull-request events, and
`pr-reviewer` requires an explicit allowed integrity state before it reviews or
comments.

Operators should be able to inspect a skipped run and see whether it skipped
because the PR was a fork, a non-KOTA branch, a missing actor metadata payload,
a blocked actor, or an actor below the required trust level.

## Constraints

- Keep GitHub webhook ingestion in `src/modules/github-webhook/`; do not move
  provider-specific event normalization into core.
- Keep the policy typed in code and tests. Do not add a markdown workflow DSL,
  parallel policy engine, or broad safe-output framework for this task.
- Treat HMAC validation, prompt-injection marking, and actor integrity as
  separate gates. Passing one gate must not imply the others passed.
- Do not default to "allow" when GitHub omits actor or association fields.
  Missing trust metadata should skip the agent step with a clear reason.
- Keep `pr-reviewer` advisory. This task should not add auto-merge or required
  status-check behavior.
- If a configurable allow/block list is needed, put it on the owning module
  config slice and cover default behavior explicitly; do not hardcode this
  repository's usernames into workflow code.

## Done When

- `github-webhook` pull-request normalization exposes typed actor metadata such
  as sender login/type, PR author login/type, author association, head SHA, and
  a derived integrity enum or enough fields for a downstream typed decision.
- The normalized event declaration and tests fail loudly if pull-request
  payload shape changes in a way that would erase the trust decision.
- `pr-reviewer` runs only when the pull-request event satisfies its required
  integrity threshold and still satisfies the existing KOTA branch and non-fork
  checks.
- Skipped reviews return distinct reasons for low-trust actor, blocked actor,
  missing trust metadata, fork PR, non-KOTA branch, and irrelevant action.
- Existing trigger-payload untrusted-content annotation remains in place; this
  task adds a pre-agent run/skip gate rather than replacing prompt labeling.
- Local `AGENTS.md` guidance under `src/modules/github-webhook/` or
  `src/modules/autonomy/workflows/pr-reviewer/` is updated only with the
  durable actor-integrity boundary, not with field inventories.

## Source / Intent

Explorer run `2026-05-17T04-11-44-082Z-explorer-99j0xj` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Gate GitHub event-triggered agent runs on actor integrity" --state ready --area modules --priority p2 --summary "Add normalized actor and trust metadata to GitHub webhook events, then require event-triggered agent workflows such as pr-reviewer to prove the event came from an allowed repository actor before exposing PR content to an autonomous review step."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External signal checked:

- `https://github.com/github/gh-aw`
- `https://github.github.com/gh-aw/introduction/architecture/`
- `https://github.github.com/gh-aw/reference/integrity/`
- `https://github.github.com/gh-aw/reference/safe-outputs/`

Relevant source summary: GitHub Agentic Workflows separates webhook/event
triggering from trust and output-safety decisions. Its integrity filtering
model filters GitHub content by author association, merge status, blocked and
trusted users, labels, and reactions before the agent sees that content. Its
safe-output model also separates agent requests from later scoped writes. KOTA
already has write scopes, approval queues, and trigger-payload untrusted
markers; this task focuses on the missing actor/content integrity decision for
GitHub event-triggered agent workflows.

Local evidence:

- `src/modules/github-webhook/index.ts` validates HMAC signatures and emits
  `github.pull_request`, but the normalized payload currently includes only
  repo, action, number, title, state, merged, head/base branch, head repo, and
  fork status.
- `src/modules/autonomy/workflows/pr-reviewer/workflow.ts` says it reviews
  KOTA-created PRs, but `assess-pr` cannot verify actor trust because the
  event payload does not carry actor or association metadata.
- `data/tasks/done/task-screen-workflow-trigger-payloads-before-agent-prompt-.md`
  completed prompt-boundary labeling for event payload text; this task is the
  complementary pre-agent eligibility gate.

## Initiative

Event-triggered agent trust boundary: GitHub/webhook authenticity, payload
injection labeling, and actor/content integrity should be separately visible
and enforced before event-derived text reaches an autonomous agent.

## Acceptance Evidence

- Focused test transcript for GitHub webhook normalization and `pr-reviewer`
  gating, for example:

```sh
pnpm test src/modules/github-webhook/github-webhook.test.ts src/modules/autonomy/workflows/pr-reviewer/workflow.test.ts
```

- A fixture or run artifact showing a low-trust same-repo `kota/task/*` PR
  event skipped before the agent step, with the skip reason visible in step
  output.
- A fixture or run artifact showing an allowed actor event still reaches the
  review step with the trigger payload wrapped in the existing untrusted-content
  marker.

## Completion Evidence

- `src/modules/github-webhook/github-webhook.test.ts` covers the typed
  `github.pull_request` event declaration, normalized sender/PR-author
  metadata, head SHA, author association, and the allowed, missing, low-trust,
  and blocked actor-integrity states.
- `src/modules/autonomy/workflows/pr-reviewer/workflow.test.ts` covers distinct
  skip reasons for irrelevant action, non-KOTA branch, fork PR, missing actor
  metadata, blocked actor, and low-trust actor, plus the allowed-event
  untrusted-content prompt marker.
- `.kota/runs/2026-05-17T04-16-44-246Z-builder-074q56/focused-test-transcript.txt`
  captures the focused GitHub webhook and `pr-reviewer` test run passing.
- `.kota/runs/2026-05-17T04-16-44-246Z-builder-074q56/low-trust-skip-artifact.json`
  records the same-repo `kota/task/*` low-trust skip fixture.
- `.kota/runs/2026-05-17T04-16-44-246Z-builder-074q56/allowed-untrusted-prompt-artifact.json`
  records the allowed actor prompt-boundary fixture.
