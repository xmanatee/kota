---
id: task-add-injection-defense-on-web-derived-content-for-autonomous-mode
title: Add injection defense on web-derived content for autonomous mode
status: backlog
priority: p2
area: autonomy
summary: KOTA's autonomous mode currently relies on tool RiskLevel and the approval queue; Anthropic's Claude Code auto-mode post adds a server-side prompt-injection probe on tool outputs before they enter agent context. Add an input-side defense for autonomy-ingested web content (explorer, web-access, read-document, email) so autonomous runs are harder to hijack through untrusted payloads.
created_at: 2026-04-20T00:30:00.000Z
updated_at: 2026-04-20T00:30:00.000Z
---

## Problem

Anthropic's Mar 2026 "Claude Code auto mode" post describes a two-layer
defense: a server-side prompt-injection probe screens tool outputs
(file reads, web fetches, shell commands) before they enter the
agent's context and, when suspicious content is detected, it adds a
warning directing the agent to treat the content as suspect and anchor
on the user's actual request. A transcript classifier then evaluates
each action before execution.

KOTA's `"autonomous"` autonomy mode runs unattended and the autonomy
loop ingests externally authored content through explorer
(watchlist-driven web fetches), `web-access`, `read-document`, and
email. Today the only guardrail on that content is tool-level
`RiskLevel` plus the approval queue — there is no layer that
inspects payload content for injection before it reaches agent
context. Tool-risk gating does not classify payload content; an
attacker-controlled watchlist entry or email body can therefore smuggle
instructions through a fully-"safe" fetch path.

## Desired Outcome

- An input-side defense runs on external content before it lands in
  the agent's context on autonomous runs. Suspicious payloads are
  either annotated with an injection warning, reduced to
  non-actionable excerpts, or diverted to the approval queue —
  whichever is the right shape for KOTA's threat model.
- The defense is module-owned (likely extending `guardrails-audit` or
  a small `injection-defense` capability) and does not grow core.
- Interactive and supervised modes can opt in; autonomous mode opts in
  by default.
- Coverage targets the content channels the autonomy loop actually
  uses: explorer fetches, `web-access` tool output, `read-document`
  output, and email bodies ingested into agent context.

## Constraints

- Do not add an LLM call per tool output if a cheaper structural check
  would catch the obvious cases; lean on cheap checks first, escalate
  to a classifier only on flagged content.
- The defense must not break normal autonomy work. False positives
  should annotate, not silently drop content.
- No test-only production flag to bypass the defense. Tests drive it
  through the normal tool-output path.
- Respect existing autonomy-mode declaration — the defense is a
  property of the autonomy-mode policy, not a per-tool override.
- Injection-defense decisions need to be observable in run artifacts
  so operators can audit false positives and missed attacks.

## Done When

- Content from external channels flows through an injection-defense
  layer before reaching agent context on autonomous runs.
- The autonomy module's `AGENTS.md` documents the defense contract and
  the policy for annotate-vs-divert decisions.
- A focused test covers at least one true-positive (injected payload
  annotated) and one false-positive (normal content untouched).
- No runtime regressions in the autonomy-loop integration test.
