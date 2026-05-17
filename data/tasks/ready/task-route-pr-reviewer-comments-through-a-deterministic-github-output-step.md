---
id: task-route-pr-reviewer-comments-through-a-deterministic-github-output-step
title: Route PR reviewer comments through a deterministic GitHub output step
status: ready
priority: p2
area: autonomy
summary: Make pr-reviewer return structured review output and let a separate approval plus github_comment step post one bounded PR comment, so external GitHub writes do not happen inside the agent step.
created_at: 2026-05-17T08:10:21Z
updated_at: 2026-05-17T08:10:21Z
---

## Problem

`pr-reviewer` still asks its agent to post the GitHub PR review comment itself.
The workflow validates actor integrity before the agent step, but the external
write remains hidden inside the agent execution surface: the workflow emits
`workflow.pr.review.posted` after the agent returns JSON, without owning the
comment body, the GitHub write step, or the exact write count.

That shape is now behind the rest of KOTA's GitHub event boundary. The newer
GitHub mention responder already uses the safer local pattern: response agent
returns structured output, a code step prepares a bounded comment, an approval
step gates the external write, and a `github_comment` tool step performs the
write. `pr-reviewer` should use the same deterministic output boundary instead
of relying on prompt instructions and whatever GitHub write path the harness
can reach.

## Desired Outcome

PR review runs become a deterministic, auditable sequence:

1. `assess-pr` gates on branch, fork status, and actor integrity before any
   agent step.
2. A read-only review agent returns strict structured JSON containing the
   recommendation and the Markdown review body or structured sections needed to
   build it.
3. A code step validates the recommendation, builds and bounds one PR comment
   body, and rejects malformed or empty output loudly.
4. The existing approval path gates the outbound comment when required.
5. A separate `github_comment` tool step posts exactly one comment to the PR.
6. `workflow.pr.review.posted` is emitted only after the GitHub write succeeds
   or after the queued approval state is visible, not merely after the agent
   drafts text.

## Constraints

- Do not build a generic safe-output DSL. Use the existing workflow step
  protocol, approval step, and GitHub module tool.
- Keep GitHub webhook ingestion in `src/modules/github-webhook/` and GitHub
  writes in `src/modules/github/`; the autonomy workflow may depend on them
  through normal module dependencies.
- Preserve the current actor-integrity gate and distinct skip reasons for
  irrelevant action, non-KOTA branch, fork PR, missing metadata, blocked actor,
  and low-trust actor.
- The review agent must not be able to write GitHub comments directly. If the
  agent needs PR diff or task context, provide it through read-only GitHub
  tools or deterministic pre-agent context, not through a broad shell escape
  that can also mutate GitHub state.
- Keep the review advisory. Do not add auto-merge, required status checks,
  labels, or branch mutation.
- Preserve the untrusted-content boundary for GitHub-authored text exposed to
  the agent.
- Comment shaping belongs in typed code and tests, not in prompt-only rules.

## Done When

- `src/modules/autonomy/workflows/pr-reviewer/workflow.ts` no longer relies on
  the agent step to post a GitHub comment.
- The review agent's output schema includes the recommendation plus the review
  content needed to build one comment body, and malformed output fails before
  any GitHub write.
- The prompt asks the agent to draft the review, not to post it.
- A deterministic `prepare-comment`-style step bounds and validates the body.
- A `github_comment` tool step performs the only PR comment write, after the
  existing approval path if policy requires approval.
- `workflow.pr.review.posted` carries the same `{ repo, prNumber,
  recommendation }` payload and fires only after the post path succeeds.
- Tests cover an allowed PR event producing exactly one `github_comment` call,
  a low-trust actor producing no agent step and no comment write, malformed or
  empty agent output failing before the tool step, and oversized review text
  being bounded or rejected according to the chosen contract.

## Source / Intent

Explorer run `2026-05-17T08-08-14-067Z-explorer-7pwjq1` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Route PR reviewer comments through a deterministic GitHub output step" --state ready --area autonomy --priority p2 --summary "Make pr-reviewer return structured review output and let a separate approval plus github_comment step post one bounded PR comment, so external GitHub writes do not happen inside the agent step."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External signal checked:

- `https://github.github.com/gh-aw/reference/safe-outputs/`
- `https://github.github.com/gh-aw/introduction/architecture/`

Relevant source summary: GitHub Agentic Workflows' safe-output model separates
read-only agent work from permission-controlled GitHub writes, including issue
comments, PR review comments, PR review submission, labels, and related
repository actions. KOTA should not import that DSL, but the local equivalent
is already present in `github-mention-responder`: structured agent output plus
a deterministic workflow tool step.

Local evidence:

- `src/modules/autonomy/workflows/pr-reviewer/prompt.md` currently says "post
  one concise GitHub review comment."
- `src/modules/autonomy/workflows/pr-reviewer/workflow.ts` comments that the
  workflow posts GitHub PR comments via `gh`, gives the agent broad autonomy
  tooling except the standard autonomy disallow list, and emits
  `workflow.pr.review.posted` directly after the agent step.
- `src/modules/autonomy/workflows/github-mention-responder/workflow.ts` already
  demonstrates the safer pattern with `prepare-comment`, `approve-comment`, and
  `github_comment`.
- `src/modules/github/github-issues.ts` already contributes `github_comment`,
  so the missing work is workflow shape, not a new GitHub capability.

## Initiative

GitHub event safety: repository-triggered agents should treat external GitHub
writes as typed, auditable workflow effects rather than prompt-internal side
effects.

## Acceptance Evidence

- Focused workflow and GitHub tool transcript, for example:

```sh
pnpm test src/modules/autonomy/workflows/pr-reviewer/workflow.test.ts src/modules/github/github.test.ts
```

- A fixture or run artifact showing an allowed `github.pull_request` payload
  reaches the review agent, prepares one bounded comment, and calls
  `github_comment` exactly once.
- A fixture or run artifact showing a low-trust actor is skipped before any
  review agent step or GitHub comment write.
