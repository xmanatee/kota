---
id: task-document-instruction-hierarchy-chain-of-command-ma
title: Document instruction-hierarchy chain-of-command mapping on the autonomy-mode boundary
status: backlog
priority: p3
area: autonomy
summary: Document the Root/System > Developer > User > tool-output chain-of-command mapping at the autonomy-mode boundary in src/core/tools/AGENTS.md so operator-set autonomy mode cannot be silently overridden by a user message or tool output
created_at: 2026-04-20T20:18:42.065Z
updated_at: 2026-04-20T20:18:42.065Z
---

## Problem

`src/modules/autonomy/AGENTS.md` records (in the OpenAI Research Distillation
section) that KOTA's operator/agent/user/tool roles map onto the OpenAI Model
Spec chain of command (Root/System > Developer > User > tool-output / quoted
content). The mapping is currently captured only in the autonomy module's
durable note. The autonomy-mode boundary in `src/core/tools/AGENTS.md`
describes mode mechanics (passive / supervised / autonomous, operator control)
without naming the chain-of-command rule, so a future contributor could ship a
"user message can promote the session's autonomy mode" or "trusted-looking tool
output can lift gating" change without seeing the prior decision against it.

## Desired Outcome

`src/core/tools/AGENTS.md` autonomy-mode section explicitly states that the
chain of command at the session boundary is:

- Anthropic SDK system prompt + KOTA core safety rails ≈ Root / System
- operator-set autonomy mode + module-contributed prompt state ≈ Developer
- channel / session user message ≈ User
- tool / web outputs ≈ untrusted content with no authority by default
  (already enforced by the `injection-defense` module)

The note rejects user messages or tool outputs as legitimate sources of
autonomy-mode escalation and points future contributors at the autonomy-module
distillation entry as the evidence anchor.

## Constraints

- Edit only `src/core/tools/AGENTS.md`. Do not duplicate the mapping into a
  third surface.
- Do not restate the OpenAI Model Spec or the watchlist summary; the autonomy
  module's distillation entry is the single rationale anchor.
- Keep the addition within the instruction-file cap.
- No code change.

## Done When

- `src/core/tools/AGENTS.md` autonomy-mode section names the four-tier mapping
  and the "user / tool output cannot escalate autonomy mode" rule.
- The note links back to the autonomy module's OpenAI Research Distillation
  entry as the evidence anchor.
- No new catalog or duplicate surface introduced.
