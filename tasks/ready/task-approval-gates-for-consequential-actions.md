---
id: task-approval-gates-for-consequential-actions
title: Add mandatory approval gates for irreversible or consequential actions
status: ready
priority: p2
area: runtime
summary: KOTA currently relies on prompt instructions to prevent dangerous autonomous actions. Hard-coded approval gates in the runtime for irreversible operations would provide structural safety guarantees.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

KOTA's builder workflow can take actions like deleting files, pushing git changes, or modifying system state. Currently, safety is enforced only through prompt instructions ("ask before destructive ops"). This is fragile: a sufficiently long or confused run could bypass prompt-level guardrails. There is no structural mechanism that requires human confirmation before irreversible actions.

## Desired Outcome

A defined set of action categories (e.g., `destructive`, `external`, `publish`) triggers a mandatory confirmation request before the tool executes. The agent cannot proceed past the gate without an explicit human approval signal. This is runtime-enforced, not prompt-enforced.

## Constraints

- Gates must not apply to read-only or reversible operations — they would create too much friction.
- The approval mechanism must work in both interactive and headless modes (different handlers, same contract).
- Keep the gated action list narrow and explicit; do not over-gate.

## Done When

- At least `destructive` category actions (file delete, git reset) require runtime-level confirmation.
- Approval can be granted by a human in interactive mode or by a configured policy in headless mode.
- There is a test showing that a destructive tool call is blocked without approval.

## Plan

The `kind: "action" | "discovery"` field added to all 41 tool registrations provides the filter layer. Approval gates should intercept `action`-kind tools with a `destructive` sub-category at the executor level, before the tool call reaches the agent SDK. Start narrow: identify which existing tools are destructive, annotate them with a `destructive` flag or sub-kind, and add an executor-level gate that calls an `approvalPolicy` handler (no-op in headless, prompt in interactive).

## References

- openfang Hands architecture: specific action categories (purchases, posts) require explicit human confirmation hard-coded into the Hand, not optional
- Gas Town Witness pattern: health monitors as a separate supervision layer for parallel agents
