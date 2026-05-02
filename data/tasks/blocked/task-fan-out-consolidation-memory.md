---
id: task-fan-out-consolidation-memory
title: Consolidate memory surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the memory surface family across macos, daemon, mobile, telegram for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-02T21:54:36.307Z
---

## Problem

The `memory` capability shipped across 4 client surfaces
(daemon, macos, mobile, telegram) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `memory`

Surfaces shipped:

- daemon
- macos
- mobile
- telegram

Recently closed fan-out tasks in this batch:

- task-add-macos-daemonclientsearchmemory-with-discrimina (macos, closed 2026-04-27T01:22:23.567Z) — Add macOS DaemonClient.searchMemory with discriminated MemorySearchResponse types and unit tests
- task-add-macos-daemonclientsearchmemory-with-discrimina (daemon, closed 2026-04-27T01:22:23.567Z) — Add macOS DaemonClient.searchMemory with discriminated MemorySearchResponse types and unit tests
- task-add-macos-menu-bar-memoryview-consuming-daemonclie (macos, closed 2026-04-27T01:56:58.607Z) — Add macOS menu-bar MemoryView consuming DaemonClient.searchMemory
- task-add-macos-menu-bar-memoryview-consuming-daemonclie (daemon, closed 2026-04-27T01:56:58.607Z) — Add macOS menu-bar MemoryView consuming DaemonClient.searchMemory
- task-add-mobile-memoryscreen-consuming-searchmemory (macos, closed 2026-04-27T02:33:01.403Z) — Add mobile MemoryScreen consuming searchMemory
- task-add-mobile-memoryscreen-consuming-searchmemory (mobile, closed 2026-04-27T02:33:01.403Z) — Add mobile MemoryScreen consuming searchMemory
- task-add-mobile-memoryscreen-consuming-searchmemory (telegram, closed 2026-04-27T02:33:01.403Z) — Add mobile MemoryScreen consuming searchMemory
- task-add-mobile-memoryscreen-consuming-searchmemory (daemon, closed 2026-04-27T02:33:01.403Z) — Add mobile MemoryScreen consuming searchMemory

## Desired Outcome

The `memory` surface family is reviewed end-to-end and either confirmed coherent
or has follow-up tasks opened for each gap. Concretely, the review produces:

- a written verdict for each consolidation dimension below;
- rendered evidence (screenshots, screencasts, transcripts, or runtime probes) showing the
  surface family from an operator's perspective, not only per-surface unit logs;
- follow-up task ids for any duplicated rendering, missing contract conformance, stale
  legacy affordance, or unaddressed accepted critic warning surfaced during review.

## Constraints

- Do not silently "fix" a surface during this review. The output is a verdict and
  follow-up tasks; substantive changes belong in the follow-up tasks themselves.
- Per-surface unit test logs do not satisfy this review. The acceptance evidence must
  show the family from an operator's vantage point.
- Do not add a parallel cross-client docs catalog. Update scoped `AGENTS.md` near the
  surfaces being reviewed when conventions need adjustment.
- A consolidation task does not block future fan-out. Open follow-up tasks for gaps
  rather than freezing the queue.

## Done When

1. **Information architecture.** The `memory` capability is discoverable from
   each surface's primary navigation/menu without overloading other entries.
2. **Cross-client capability contract.** All client surfaces speak the same daemon contract
   (request shape, discriminated result arms, error codes, unavailable-state codes).
3. **Duplicated route/error/rendering logic.** Any duplicate decoder, error renderer, or
   provider-readiness probe across clients is named, with a follow-up task to fold it.
4. **Provider readiness and unavailable state.** Each surface degrades gracefully when the
   underlying provider is unavailable, surfacing the daemon's typed failure code.
5. **Live runtime/screenshot/transcript evidence.** A rendered artifact (screenshot,
   screencast, snapshot fixture, or runtime probe) per surface proves the surface family
   is coherent end-to-end, not only that per-surface tests pass.
6. **Stale legacy affordances.** Older surface affordances superseded by this fan-out are
   either removed or filed as removal tasks.
7. **Docs/AGENTS reality check.** Scoped `AGENTS.md` files near the reviewed surfaces
   describe what shipped; stale lines are pruned in the same change.
8. **Accepted critic warning review.** Any compatibility shim, baseline-only ratchet, or
   text-only visual proof previously accepted by a critic on these fan-out commits is
   either retired or has a follow-up task naming the retirement plan.

## Source / Intent

Auto-seeded by the fan-out-consolidator workflow after the `memory` capability
landed across 4 client surfaces between 2026-04-27T01:22:23.567Z
and 2026-04-27T02:33:01.403Z. The 2026-04-28 broad daemon review found that fan-out batches
without a holistic consolidation pass left an overloaded operator surface despite green
per-surface tests. This task is the autonomy queue's recurring corrective pass.

## Initiative

Autonomy quality control: fan-out should end in a coherent product surface, not just a
checklist of parity commits. Each capability gets one consolidation review per shipped
fan-out batch, and the review's output is operator-actionable follow-up tasks.

## Acceptance Evidence

- Rendered screenshots or screencasts (one per client surface) committed under a run
  directory or as snapshot fixtures, demonstrating the consolidated surface family.
- A transcript or runtime probe artifact showing each surface respects the same daemon
  contract (matching arms for the same request).
- A list of follow-up task ids opened for each consolidation finding, or a written note
  stating no follow-up was needed and why.
- Updated scoped `AGENTS.md` lines reflecting any convention adjustments arising from
  the review.

## Headless Review (completed)

Recorded under
`.kota/runs/2026-05-02T21-46-19-670Z-builder-o6sqtm/memory-consolidation/`:

- `contract-probe.json` — runtime probe of `src/modules/memory/routes.ts`
  `handleSearchMemory` covering all five envelope arms every client
  decodes (no-provider 500, semantic-unavailable 200, keyword success
  200, empty-query 200, limit truncation 200).
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — CLI transcript exercising
  `kota memory --help`, `kota memory list`, `kota memory search` (with
  match, with no match, empty query, semantic), and `kota memory
  reindex` against the local store. Proves end-to-end propagation of
  the daemon-issued `semantic_unavailable` arm and the
  no-embedding-provider reindex message through the CLI surface.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions; no follow-up tasks were warranted, and the only
  convention adjustment surfaced (adding the mobile `MemoryScreen` to
  the operator pull-surface list in `src/modules/memory/AGENTS.md`)
  is applied in this same change.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/memory-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the three visual memory surfaces — telegram (`/memory <query>` rendered message: populated, no-match, semantic-unavailable, and empty/usage-hint cases), mobile (`MemoryScreen` showing populated, empty-query hint, no-match card, semantic-unavailable banner, and offline banner), and macOS (`AskUnifiedView` with the Memory mode populated, no-match line, and semantic-unavailable orange caption). Operator runs each client against a daemon (with and without an embedding-backed memory provider configured) and commits the rendered artifacts under .kota/runs/memory-consolidation-screens-<stamp>/{telegram,mobile,macos}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T21-46-19-670Z-builder-o6sqtm/memory-consolidation/.
```
