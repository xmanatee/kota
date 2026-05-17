---
id: task-screen-workflow-trigger-payloads-before-agent-prompt-
title: Screen workflow trigger payloads before agent prompt exposure
status: ready
priority: p2
area: runtime
summary: Treat workflow trigger payload text as untrusted input at the agent-prompt boundary so webhook, GitHub, and manual trigger context cannot become unscreened agent instructions.
created_at: 2026-05-17T03:39:19Z
updated_at: 2026-05-17T03:39:19Z
---

## Problem

KOTA validates workflow trigger payload shape with `inputSchema`, and it
screens content-ingest tool output through `injection-defense`, but the
agent-step prompt builder still serializes `trigger.payload` directly into
the next autonomous agent prompt. That makes trigger payload text a separate
prompt-ingest path with weaker treatment than web, document, browser, and
operator-answer content.

This matters most for event and webhook driven workflows. A GitHub pull
request title, issue body, webhook body, manually supplied payload, or
third-party event field can be valid JSON and still contain instruction-shaped
text. Shape validation proves the payload has the expected fields; it does not
prove that those fields are safe to merge into the agent prompt as ordinary
instructions.

## Desired Outcome

Workflow trigger payloads that reach an agent prompt are clearly treated as
data, not instructions. The prompt builder keeps runtime facts discoverable
but wraps or annotates payload text through a single core-owned untrusted
content path before it is appended to the agent prompt.

The behavior should be explicit enough that an operator can inspect an agent
input artifact and tell which parts are trusted workflow metadata and which
parts came from the trigger payload.

## Constraints

- Keep the implementation in the workflow runtime boundary. Do not import the
  module-owned `injection-defense` middleware into core.
- Reuse or factor the existing core structural detector in
  `src/core/util/injection-detector.ts`; do not add a provider call or a
  heavyweight classifier to prompt construction.
- Preserve machine-readable payload JSON for legitimate workflows. The fix is
  annotation and trust labeling, not dropping fields or silently coercing the
  payload.
- Do not add per-workflow opt-out flags or compatibility shims. Trigger
  payload provenance is a runtime boundary, so the default should be safe and
  uniform.
- Internal runtime facts such as workflow name, run id, run directory,
  prompt path, and project root remain outside the untrusted payload block.
- If a workflow needs derived trusted facts from a payload, derive them in a
  typed code step and expose only that derived result deliberately.

## Done When

- `buildAgentPrompt` no longer appends raw `trigger.payload` as an ordinary
  JSON block. Trigger payload content is labeled as untrusted data and, when
  suspicious instruction patterns are detected, includes the same kind of
  reason tags operators already see from injection screening.
- Tests cover a benign trigger payload, a malicious instruction-shaped payload,
  and an event payload that contains valid workflow fields plus hostile text.
- A PR-reviewer or webhook-triggered workflow fixture proves a GitHub/webhook
  payload cannot reach the agent prompt without the untrusted-content marker.
- Existing workflow input-schema validation still runs before queueing and is
  not replaced by the prompt-screening layer.
- Agent input artifacts under `.kota/runs/<run-id>/steps/` show the annotated
  trigger payload block so reviewers can verify the boundary from run evidence.

## Source / Intent

Explorer run `2026-05-17T03-36-21-914Z-explorer-3s43c9` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` are all still operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Screen workflow trigger payloads before agent prompt exposure" --state ready --area runtime --priority p2 --summary "Treat workflow trigger payload text as untrusted input at the agent-prompt boundary so webhook, GitHub, and manual trigger context cannot become unscreened agent instructions."
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the network-restricted workflow sandbox. This file
follows the normalized task schema manually.

External signals checked:

- `https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/`
  describes GitHub Agentic Workflows as AI agents running from GitHub Actions
  with read-only defaults, sandboxing, safe outputs, and flexible event
  triggers.
- `https://github.com/github/gh-aw` documents guardrails including input
  sanitization, tool allow-listing, compile-time validation, sandboxed
  execution, and sanitized safe outputs.
- `https://arxiv.org/abs/2605.07135` introduces Agentic Workflow Injection:
  untrusted GitHub event context such as issue bodies, pull request
  descriptions, and comments reaching agent prompts or later script sinks.

Local evidence:

- `src/core/workflow/steps/step-executor-agent-prompt.ts` appends
  `JSON.stringify(trigger.payload, null, 2)` directly under `Trigger payload`.
- `src/core/workflow/run-executor.ts` injects webhook payload bodies into
  step outputs, while the trigger payload itself is always visible to agent
  prompts.
- `src/modules/autonomy/workflows/pr-reviewer/workflow.ts` validates a subset
  of a GitHub pull request event in a code step, but the later agent prompt
  still receives the original trigger payload.
- `src/modules/injection-defense/AGENTS.md` scopes current screening to
  content-ingest tool output. It does not cover workflow trigger payloads.

## Initiative

Prompt-ingest trust boundaries: every path that moves external or event-derived
text into an autonomous agent prompt should be explicitly marked as data and
auditable from run artifacts.

## Acceptance Evidence

- Focused test transcript for the prompt builder and at least one event-driven
  workflow fixture, for example
  `pnpm test src/core/workflow/run-executor-step.test.ts src/modules/autonomy/workflows/pr-reviewer/workflow.test.ts`.
- A run input artifact or fixture showing a hostile trigger payload wrapped in
  the untrusted-content marker with reason tags, while trusted runtime facts
  remain outside that block.
- Diff review confirms the change uses a core-owned helper and does not import
  module-owned `injection-defense` into the workflow runtime.
