---
id: task-adopt-augmentcode-agentsmd-guidance-into-the-exist
title: Adopt augmentcode AGENTS.md guidance into the existing AGENTS.md hierarchy
status: ready
priority: p2
area: docs
summary: Read the augmentcode AGENTS.md guide, distill durable items, and extend the existing AGENTS.md hierarchy where they raise the bar without duplicating current rules.
created_at: 2026-05-02T15:28:19.137Z
updated_at: 2026-05-03T02:48:12.565Z
---

## Problem

Owner flagged https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files
as a body of guidelines they want adopted into KOTA's `AGENTS.md` hierarchy
("I really want all that to be adopted and to nicely extend existing rules").
KOTA already enforces a strict `AGENTS.md` philosophy — local-scope, terse,
no inventory, no migration notes, durable conventions only. The augmentcode
post is an external good-practices catalog written for general agent stacks;
not all of it will fit, and direct copy-paste would break KOTA's "no
duplication, scope guidance close to its subject" rule.

## Desired Outcome

- Augmentcode's guide is read and distilled into a short list of items that
  raise the quality bar of KOTA's `AGENTS.md` hierarchy beyond what the
  existing rules already enforce.
- Each adopted item lands in the correct scope: root `AGENTS.md` only when
  the rule is genuinely cross-cutting; otherwise the narrowest applicable
  directory.
- Items already covered by KOTA rules are explicitly skipped (with a brief
  note in the run artifact) rather than restated, to avoid duplication.
- Items that conflict with KOTA's documented stance (e.g. file-by-file
  inventories, "previously" notes, severity icons, version stamps) are
  rejected with a one-line reason.

## Constraints

- Do not create a parallel "AGENTS.md style guide" doc. The rules belong in
  the AGENTS.md files themselves; the meta-guidance lives in the existing
  root `AGENTS.md` (Documentation section).
- Do not duplicate guidance that already exists. Cut, do not add, when an
  external rule restates an internal rule.
- Preserve the existing strict ban on file inventories, command lists,
  schema enumerations, migration notes, and decorative formatting.
- Keep individual `AGENTS.md` files concise; if an adopted item would push
  a file past its useful length, split or relocate.

## Done When

- Edits land in the relevant `AGENTS.md` files extending or sharpening
  durable rules.
- A short note in the run artifact lists each augmentcode item with a
  verdict: adopted (and where), skipped (already covered), or rejected
  (with reason).
- Existing docs validation remains green.

## Source / Intent

2026-05-02 inbox capture
(`data/inbox/resources-to-research-and-investigate-and-use-for-inpiration.md`):

> Some inpiration and good-practices and guidelines on AGENTS.md files:
> https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files
> - I really want all that to be adopted and to nicely extend existing
> rules

This is the only firm directive in the resources capture; the remaining
links in that capture are research pointers handled by watchlist updates
or dropped per `data/AGENTS.md` (no aggregator/single-post entries).

## Initiative

Docs hygiene: keep KOTA's `AGENTS.md` hierarchy at the leading edge of
agent-facing guidance without losing the strict scoping discipline that
keeps it useful.

## Acceptance Evidence

- Diff to one or more `AGENTS.md` files.
- Run-artifact note listing the augmentcode items with adopted / skipped /
  rejected verdicts and target files for adopted items.
