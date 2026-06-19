---
id: task-fold-duplicated-recall-rendering-helpers
title: Fold duplicated recall rendering helpers
status: ready
priority: p2
area: client
summary: Fold duplicated recall hit description and score rendering across web, mobile, Apple, and module-owned plain-text surfaces into one durable client-safe contract.
created_at: 2026-06-18T17:08:06.305Z
updated_at: 2026-06-19T06:15:53.549Z
task_class: Product
---

## Problem

The recall consolidation review found duplicated recall-hit rendering logic
after the cross-client fan-out shipped:

- `src/modules/recall/render.ts` owns the module-side plain-text
  `describeHit`, score formatting, and column layout used by the CLI,
  Telegram `/recall`, and the recall tool.
- `clients/mobile/src/recallRender.ts` mirrors that per-source
  description and plain-text line shape for mobile recall/answer surfaces.
- `clients/apple/Sources/KotaShared/Daemon/RecallModels.swift` mirrors the
  same `RecallHit.describe` and `renderRecallHitsPlain` behavior in Swift.
- `clients/web/src/components/sidebar/RecallPanel.tsx` owns a separate
  `describeHit` plus score rendering for the web sidebar panel.

The mirrors are intentional enough to have comments and tests, but they are
not yet folded into one durable contract. A future sixth source, answer-arm
wording tweak, or score-format change could drift by surface again.

## Desired Outcome

Recall hit rendering has one clear source of truth or one shared golden
contract that every surface consumes. Operators should see the same
source labels, score precision, answer success/failure wording, and
per-source descriptions across Telegram/CLI/tool plain text, web, mobile,
and Apple without manually comparing four helper implementations.

## Constraints

- Keep clients thin: they render daemon contract data and do not parse
  `.kota/` files or own recall ranking semantics.
- Do not move platform UI rendering wholesale into the daemon. If Swift or
  React Native cannot import the TypeScript helper directly, use generated
  fixtures, shared conformance cases, or another explicit contract that
  makes drift fail mechanically.
- Preserve the five-source recall contract
  `knowledge | memory | history | tasks | answer`, including answer hits
  whose nested result is `ok: false`.
- Do not add a parallel docs catalog of render rules. Keep durable guidance
  near the owning module/client boundaries and enforce details with tests.

## Done When

1. The duplicated recall render helpers in web, mobile, Apple, and the
   module-owned plain-text path are either folded into a shared
   client-safe helper or covered by a single golden render fixture consumed
   by all four surfaces.
2. The golden cases cover knowledge, memory, history, tasks, answer
   success, answer failure, empty results, and `semantic_unavailable`.
3. A score-format or per-source description change in one surface without
   the contract update fails focused tests.
4. Scoped `AGENTS.md` guidance near recall/client surfaces reflects the
   chosen ownership model and removes comments that merely admit a mirror
   without enforcement.
5. The recall consolidation record can cite this task as the follow-up for
   duplicated route/error/rendering logic.

## Source / Intent

Opened by the recall fan-out consolidation repair on 2026-06-18 after the
critic found Done When 3 incomplete: duplicate recall rendering was named in
code comments but had no fold-up follow-up. Evidence lives in
`.kota/runs/2026-06-18T16-37-10-512Z-builder-qsbzam/recall-consolidation/`.

## Initiative

Cross-client coherence for operator recall surfaces.

## Acceptance Evidence

- Focused test logs for the module render helper, web `RecallPanel`, mobile
  recall render helper/screen, and Apple `RecallView`/decoder suite showing
  they consume the same render contract or golden cases.
- A short run artifact under `.kota/runs/<run-id>/` showing the shared
  fixture rendered for Telegram/CLI plain text plus web, mobile, and Apple.
- Updated recall consolidation note naming this task as closed or superseded.
