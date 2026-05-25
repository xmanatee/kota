---
id: task-trigger-security-review-when-security-sensitive-co
title: Trigger security-review when security-sensitive code changes make it due
status: done
priority: p2
area: autonomy
summary: Route a bounded semantic event into the existing security-review workflow when repo changes touch security-sensitive surfaces, so security review is deliberate and paced instead of manual-only.
created_at: 2026-05-25T11:37:04.983Z
updated_at: 2026-05-25T11:51:37Z
---

## Problem

KOTA has a bounded `security-review` workflow, but it only runs when an
operator or some future workflow emits `autonomy.security-review.requested`.
That leaves the review path disconnected from the repo states that most need
it: changes to auth/approval boundaries, daemon routes, tool execution,
external fetches, secret handling, MCP transport, or workflow/task mutation.

The queue can therefore become empty while security-sensitive changes since
the last review have not been checked, or the opposite failure mode can happen
if a naive periodic trigger is added later: repeated expensive reviews with no
new signal and no regard for existing security follow-up capacity.

## Desired Outcome

Security review becomes a paced, semantic queue-shaping behavior. The
dispatcher or a focused helper emits a dedicated event when repo-local evidence
shows `security-review` is due, and the existing workflow accepts that event in
addition to the manual request event.

The due decision is deterministic and auditable: it explains which
security-sensitive surfaces changed, what review run or head SHA they are being
compared against, and why the workflow is or is not launched. Existing
confirmed security tasks remain the capacity signal; KOTA should avoid piling
new review batches on top of unresolved security findings unless a high-risk
change makes the review clearly necessary.

## Constraints

- Keep routing semantic. Do not make `security-review` listen to `runtime.idle`;
  the dispatcher remains the only idle listener and emits a named event that
  describes the due state.
- Reuse existing run artifacts, git history, task queue state, and the
  security-review surface model. Do not add a second findings database,
  scanner state directory, or durable audit surface.
- Keep spend bounded with a cooldown and a last-reviewed-head or equivalent
  freshness check. An idle loop with no new security-sensitive change must not
  keep launching review.
- Preserve the existing manual request path for operator-triggered review.
- If open security follow-up tasks already exist, treat them as triage capacity
  pressure and skip or defer routine review unless the due signal is tied to a
  new high-risk surface change.
- Keep source, generated output, candidate excerpts, and agent findings under
  the existing injection-defense and artifact-only review posture.

## Done When

- A deterministic due-check helper can report changed security-sensitive
  surfaces, last relevant review evidence, open security-task pressure, and the
  resulting due/not-due decision.
- Dispatcher emits a semantic event such as `autonomy.security-review.due` only
  when the helper reports review is due, and its step output records the due
  rationale.
- `security-review` triggers on that semantic event while retaining the manual
  `autonomy.security-review.requested` trigger.
- Repeated idle dispatches without new qualifying changes do not relaunch
  security review.
- Existing confirmed security-review follow-up tasks prevent routine review
  fan-out unless the new change is explicitly high-risk.
- Focused tests cover due, not-due, existing-open-security-task, and
  no-repeat-after-reviewed cases.

## Source / Intent

Explorer run `2026-05-25T11-33-32-564Z-explorer-5t4foc` ran on an empty
actionable queue (`ready=0`, `doing=0`, `pullable=0`) with strategic blocked
alternatives all gated by `operator-capture`, so none could be promoted.

External signal reviewed on 2026-05-25:

- https://www.anthropic.com/research/glasswing-initial-update

Anthropic's May 22, 2026 Project Glasswing update says AI-assisted security
work is shifting the bottleneck from vulnerability discovery to verification,
disclosure, and patch capacity. It also describes a harness that maps a
codebase, spins up scanning subagents, triages findings, and writes reports.

Local inspection found that KOTA already adopted the right scanner shape in
`task-add-an-agentic-security-review-workflow`: deterministic repo-local
candidates, bounded investigation, revalidation, run artifacts, and normal
follow-up tasks. That prior task explicitly left room for a future
queue-shaping workflow. The remaining gap is pacing and triggering the
existing workflow when KOTA's own security-sensitive surfaces change, without
creating a second scanner or running review continuously.

Strategic blocked alternatives considered and not chosen:

- `task-add-cross-preset-runtime-parity-gate` - still requires
  operator-captured harness transcripts.
- `task-add-streamable-http-transport-to-the-mcp-server` - still requires a
  live local HTTP transcript on a host that allows listening.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` - still requires
  live harness credentials and operator-facilitated parity artifacts.
- `task-enable-autonomous-access-to-auth-walled-sources-so` - still requires
  an authenticated browser/source-access artifact.
- `task-introduce-a-rich-cli-rendering-abstraction-for-all` - still requires
  operator-captured CLI rendering evidence.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused test transcript for the due-check helper, dispatcher routing, and
  `security-review` trigger behavior.
- A synthetic run artifact or fixture showing a due rationale with changed
  security-sensitive surfaces and a later not-due decision after review
  evidence is recorded.
- Queue validation passes with no duplicate security task ids or stale state.
