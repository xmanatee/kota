---
status: open
priority: p2
---

# Synthesize the support triage ingestion decision

## Problem

The support triage prototype needs one bounded decision before implementation:
which ingestion path should be used for the Q3 offline release. The local
research packet has conflicting notes, including stale cloud-OCR guidance,
partner-roadmap optimism, a lab benchmark with a narrower scope than the
release constraint, and decisive security plus pilot evidence.

The goal is not to write a persuasive narrative. The goal is to produce a
machine-checkable research synthesis artifact that cites real local sources,
rejects weaker evidence explicitly, and records how the conflict was resolved.

## Desired Outcome

Read the plain-text sources in `research/packet/` and write
`research-synthesis-result.json` with:

- `selectedDecision`
- cited source ids and paths
- rejected-source reasons
- conflict-resolution notes
- `verificationCommand`
- objective metric values

Then run:

```sh
node scripts/check-research-synthesis.mjs
```

## Constraints

- Use only the local source packet. Do not use network access, external
  services, live model calls, generated notebooks, or large dependencies.
- Do not edit `research/packet/`, `scripts/check-research-synthesis*.mjs`,
  `package.json`, fixture metadata, or runner files.
- Do not invent source ids or cite source paths that do not exist.
- Do not choose by majority vote. Decisive release constraints outrank stale,
  narrower, or speculative notes.
- Do not leave only prose; the scorer reads `research-synthesis-result.json`.

## Done When

- `research-synthesis-result.json` selects the decision supported by the
  decisive security and pilot evidence.
- The artifact cites only real local source ids and paths.
- The artifact rejects stale, scoped-conflicting, and speculative sources with
  concrete reasons.
- The conflict-resolution section names why decisive evidence outranks the
  conflicting notes.
- `node scripts/check-research-synthesis.mjs` exits successfully.
- This task has moved from `data/tasks/` to `data/tasks/archive/`.

## Acceptance Evidence

- Command output from `node scripts/check-research-synthesis.mjs`.
- The generated `research-synthesis-result.json` artifact.
- The generated `research-synthesis-verification.json` artifact.
- The fixture run artifact records the `source_discipline_score` objective
  metric.

## Source / Intent

Eval-harness fixture seed for measuring source-grounded research synthesis.
The builder should turn conflicting local evidence into an auditable decision
artifact without inventing citations, trusting stale notes, or hiding conflicts
inside polished prose.

## Initiative

Outcome-grade autonomy evaluation: KOTA should grade whether builders can turn
local research evidence into a cited decision artifact with deterministic
pass/fail predicates.
