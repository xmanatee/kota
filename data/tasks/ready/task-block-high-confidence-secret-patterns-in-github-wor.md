---
id: task-block-high-confidence-secret-patterns-in-github-wor
title: Block high-confidence secret patterns in GitHub workflow comments
status: ready
priority: p2
area: modules
summary: Add a deterministic outbound safety gate for agent-authored GitHub comment bodies so PR-review and mention workflows fail before posting high-confidence secret or token patterns.
created_at: 2026-05-19T23:34:36Z
updated_at: 2026-05-19T23:34:36Z
---

## Problem

KOTA's GitHub-triggered autonomy workflows already authenticate webhook
deliveries, normalize actor integrity, wrap trigger payloads as untrusted data
before agent prompts, and keep the GitHub write as a separate workflow step.
That covers the prompt-ingest side of Agentic Workflow Injection, but the
outbound sink is still only bounded by size, schema shape, guardrails policy,
and approval.

The `pr-reviewer` and `github-mention-responder` workflows accept an
agent-authored `body` string, add deterministic framing, and pass the result
to `github_comment`. If an agent output ever contains a high-confidence token
or secret pattern, the workflow should fail before the body reaches the
external comment step rather than relying on prompt posture or a human approval
review to catch it.

## Desired Outcome

GitHub workflow comments have a shared outbound secret-pattern gate. Any
comment body prepared from agent output is scanned for high-confidence secret
or token shapes before `github_comment` can run. Clean comments keep the
current behavior; suspect comments fail loudly with a diagnostic that names the
matched secret class without echoing the secret value.

The gate should cover the PR-reviewer and GitHub mention responder paths first,
and should be reusable by future GitHub-commenting autonomy workflows instead
of duplicating regexes in each workflow.

## Constraints

- Keep this as deterministic code near the GitHub/autonomy workflow boundary;
  do not add a model-based classifier or a broad content-moderation service.
- Scan only outbound comment bodies, not arbitrary repo files or all workflow
  artifacts.
- Match high-confidence credential forms such as GitHub tokens, OpenAI keys,
  Anthropic keys, AWS access keys, private-key headers, bearer-token literals,
  and common API-key assignment shapes. Avoid vague words like "secret" as a
  blocker by themselves.
- Never include the matched secret text in thrown errors, step output, run
  artifacts, or GitHub comments. Diagnostics may name a class such as
  `github-token` or `private-key-block`.
- Preserve existing approval and guardrails behavior. This gate is an
  additional fail-closed precondition before external posting, not a
  replacement for approvals.
- `github-mention-intake` deterministic task-reference and needs-detail
  comments should remain covered by focused tests; if the shared helper is
  applied there too, it must not block normal task ids, paths, or GitHub URLs.

## Done When

- A shared helper validates outbound GitHub comment bodies and returns a typed
  clean/suspect result without exposing matched secret values.
- `pr-reviewer` fails before `github_comment` when the review agent returns a
  body containing a high-confidence token or private-key pattern.
- `github-mention-responder` fails before `github_comment` when the response
  agent returns a body containing a high-confidence token or private-key
  pattern.
- Focused tests prove clean review, responder, and intake comments still post
  through the existing bounded body and approval/guardrails flow.
- Tests prove the failure diagnostics name only the secret class and do not
  include the raw token, key, or private-key material.

## Source / Intent

Explorer run `2026-05-19T23-31-28-812Z-explorer-dmx5sy` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Block high-confidence secret patterns in GitHub workflow comments" --state ready --area modules --priority p2 --summary "Add a deterministic outbound safety gate for agent-authored GitHub comment bodies so PR-review and mention workflows fail before posting high-confidence secret or token patterns."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signals checked:

- `https://arxiv.org/abs/2605.07135` defines Agentic Workflow Injection and
  distinguishes Prompt-to-Agent from Prompt-to-Script / downstream sink flows.
  KOTA's completed `task-screen-workflow-trigger-payloads-before-agent-prompt-`
  covers the prompt-ingest side; this task covers the GitHub-comment sink side.
- `https://securitylab.github.com/advisories/GHSL-2025-093_PraisonAI/`
  documents a GitHub Actions agent workflow where user-controlled issue fields
  flowed through privileged automation and could lead to secret exfiltration.
- `https://docs.github.com/en/actions/concepts/security/script-injections`
  names GitHub event fields such as issue titles and pull request bodies as
  untrusted and warns against letting untrusted values flow to code or API
  sinks.

Local evidence:

- `src/modules/autonomy/workflows/pr-reviewer/workflow.ts` validates the
  review agent's JSON shape and bounds body length before `github_comment`,
  but does not scan the agent-authored body for credential patterns.
- `src/modules/autonomy/workflows/github-mention-responder/workflow.ts` has
  the same agent-output-to-comment path.
- `src/modules/autonomy/workflows/github-mention-intake/workflow.ts` posts
  deterministic reference / needs-detail comments, so it is a useful clean
  control for the shared helper.

## Initiative

Agentic workflow sink safety: external writes should have deterministic
last-mile checks for high-impact exfiltration patterns, not only prompt
boundaries and operator approval.

## Acceptance Evidence

- Focused test output for the GitHub comment safety helper and the
  `pr-reviewer`, `github-mention-responder`, and `github-mention-intake`
  workflow tests.
- A negative test fixture showing an agent-produced fake token is blocked
  before `github_comment`, with an error message that names the secret class
  but does not echo the token.
- Existing clean GitHub workflow comment tests continue to pass.
