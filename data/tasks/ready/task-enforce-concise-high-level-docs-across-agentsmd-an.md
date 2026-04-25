---
id: task-enforce-concise-high-level-docs-across-agentsmd-an
title: Enforce concise high-level docs across AGENTS.md and prevent agent-driven doc bloat
status: ready
priority: p2
area: autonomy
summary: Add an enforcement mechanism (improver/critic check, lint, or new agent) that prevents agents from bloating AGENTS.md and other docs with file inventories, mechanism walkthroughs, or duplicated info.
created_at: 2026-04-25T12:27:43.474Z
updated_at: 2026-04-25T12:29:46.127Z
---

## Problem

The repo's documentation rules at the root `AGENTS.md` and `CLAUDE.md` are
already explicit: docs should be concise, high-level, scoped to the narrowest
applicable directory, and free of file inventories, function lists, mechanism
walkthroughs, migration notes, and content duplicated from code. In practice,
agents routinely bloat `AGENTS.md` files with details that a single `ls` or
`grep` would reveal, with step-by-step explanations of mechanisms already
visible in source, and with duplicated guidance copied from other docs.
Nothing currently catches this either at agent-step time or at validation
time, so the rules drift in autonomous runs.

## Desired Outcome

A durable mechanism prevents this drift without re-stating the rules in every
prompt. The rules stay in one place (root `AGENTS.md` / `CLAUDE.md`) and are
enforced by:

1. an automated check (lint, validation, or a focused judge) that flags doc
   diffs containing the prohibited shapes, and/or
2. a calibrated agent-step check (extension of the critic or improver
   semantic gate) that fails or warns on docs-only churn that adds
   inventories, mechanism prose, or duplicated content.

After the change, runs that try to expand `AGENTS.md` with file lists or
duplicated explanations are blocked or flagged with a clear message pointing
back to the documentation rules, and improver retracts existing bloat as it
encounters it.

## Constraints

- Do not add a new prompt-level directive in every workflow's prompt.md.
  Conventions live in the existing root/scope `AGENTS.md` files; enforcement
  belongs in code or in a focused judge.
- Do not introduce a parallel "lessons" or "doc audit" store. Evidence stays
  in run artifacts and git history.
- The enforcement must distinguish between durable conventions (which belong
  in `AGENTS.md`) and code/inventory detail (which does not). False positives
  on legitimate convention edits would be worse than the current state.
- Prefer extending the existing critic or improver-semantic-gate over adding
  a brand-new workflow. If a dedicated check is warranted, it should reuse
  the agent-judge primitive, not stand up a parallel gate runtime.
- Mechanical rules (e.g. "no top-level file path enumerations longer than N
  entries", "no `## Internal Subdomains`-style listings beyond a budget")
  should land as deterministic checks where they can; judgment-heavy calls
  stay with the agent judge.

## Done When

- A check exists that flags doc-bloat patterns on staged diffs and is wired
  into the autonomous loop (critic, improver semantic gate, or a deterministic
  validation step). The check has at least one regression fixture seeded from
  a real bloated diff.
- A documented rationale lives in the relevant scoped `AGENTS.md` (e.g.
  improver or critic) explaining what the check enforces and why, without
  duplicating the documentation rules themselves.
- A run trace shows the check correctly rejecting (or flagging) a synthetic
  bloated diff and passing a clean convention-level diff.
- No new prompt-level rules were added to individual workflow prompts to
  accomplish this.

## Source / Intent

2026-04-25 inbox capture (`data/inbox/docs-bloating.md`, verbatim):

> Currently it feels like some agents bloat documentation with small
> details ... that is wrong.. there should've been mechanism that prevents
> that. Not sure what the best place for that should be. investigate
> existing instructions on how documentation should be kept and
> maintained.. overall AGENTS.md shouldn't contain things that can be
> checked in a single bash command.. e.g. reading a file or listing files
> or explanation of how specific mechanism works! AGENTS.md is for concise
> (CONCISE!!!) high-level overviews, best-practices and guidelines that
> aren't obvious. There should be no duplication of these guidelines of
> any info. Each piece of data or info must be in AGENTS.md in its scope
> (in correct directory). Make sure that is respected in existing codebase
> and respected in the future runs.. maybe it should be in critic... maybe
> just in root AGENTS.md... maybe in archivarious... maybe in a new
> dedicated agent checking that all...

The rules already exist; the gap is enforcement against autonomous-run
drift. The owner explicitly listed several candidate homes (critic,
root AGENTS.md, dedicated agent) — the task should pick one with a
recorded rationale, not silently invent a new surface.

## Initiative

Durable autonomous quality: the conventions in `AGENTS.md` files stay
true over long autonomous runs because the loop catches drift mechanically
or with a calibrated judge, not because operators police diffs by hand.

## Acceptance Evidence

- Run trace under `.kota/runs/` showing the new check correctly handling
  both a bloated docs diff (rejected/flagged) and a clean convention-level
  edit (passed).
- A small fixture or test that exercises the check against a recorded
  bloated diff and asserts the verdict.
- Diff to the chosen enforcement surface (`critic.ts`,
  `improver-semantic-gate.ts`, or a new deterministic check) plus a one-
  line update to the relevant scoped `AGENTS.md` recording the decision.
