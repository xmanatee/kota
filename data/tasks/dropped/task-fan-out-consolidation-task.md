---
id: task-fan-out-consolidation-task
title: Consolidate task surfaces across clients
status: dropped
priority: p2
area: client
summary: Review the task surface family across macos, mobile, telegram, cli, daemon for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-07T00:00:00.000Z
---

## Problem

The `task` capability shipped across 5 client surfaces
(cli, daemon, macos, mobile, telegram) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `task`

Surfaces shipped:

- cli
- daemon
- macos
- mobile
- telegram

Recently closed fan-out tasks in this batch:

- task-add-mobile-tasksearchscreen-consuming-searchtasks (macos, closed 2026-04-27T07:00:28.647Z) — Add mobile TaskSearchScreen consuming searchTasks
- task-add-mobile-tasksearchscreen-consuming-searchtasks (mobile, closed 2026-04-27T07:00:28.647Z) — Add mobile TaskSearchScreen consuming searchTasks
- task-add-mobile-tasksearchscreen-consuming-searchtasks (telegram, closed 2026-04-27T07:00:28.647Z) — Add mobile TaskSearchScreen consuming searchTasks
- task-add-mobile-tasksearchscreen-consuming-searchtasks (cli, closed 2026-04-27T07:00:28.647Z) — Add mobile TaskSearchScreen consuming searchTasks
- task-add-mobile-tasksearchscreen-consuming-searchtasks (daemon, closed 2026-04-27T07:00:28.647Z) — Add mobile TaskSearchScreen consuming searchTasks

## Desired Outcome

The `task` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `task` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `task` capability
landed across 5 client surfaces between 2026-04-27T07:00:28.647Z
and 2026-04-27T07:00:28.647Z. The 2026-04-28 broad daemon review found that fan-out batches
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

## Dropped Reason

Dropped during the 2026-05-07 corrective pass. The task-search consolidation
was seeded from repeated surface markers on a single mobile task rather than
from a distinct multi-surface fan-out batch. Any real task-search client gap
should be filed as a normal follow-up with concrete evidence requirements,
not held open as a generated consolidation blocker.

## Headless Review (completed)

Recorded under
`.kota/runs/2026-05-02T23-03-38-854Z-builder-l9eg76/task-consolidation/`:

- `contract-probe.json` — runtime probe of
  `src/modules/repo-tasks/routes.ts` `taskControlRoutes`
  `GET /tasks/search` covering five envelope arms: semantic search
  with no embedding provider configured (default keyword-only
  `RepoTasksDefaultStore`, returns `semantic_unavailable`); keyword
  search success against the same default provider (pins the eight-
  field `RepoTaskSearchHit` shape); semantic success against a stub
  embedding provider; semantic degrade-on-throw (provider raises →
  `semantic_unavailable`); `state=ready&state=doing` filter
  passthrough on the keyword path. The cross-client conformance gate
  (`clients/conformance/contract-fixture.json` `tasksSearch.*`)
  already pins the same envelope across TypeScript, Vitest web,
  mobile Jest, and macOS Swift decoders.
- `probe-contract.mjs` — the probe source kept alongside its
  artifact.
- `cli-transcript.txt` — CLI transcript exercising `kota --help`
  discoverability (proves `task` is in the top-level command
  inventory), full `kota task --help` and `kota task search --help`
  surfaces, `kota task list` against the live project tree, plus
  semantic / `--keyword` / `--keyword --json` / `--json` /
  empty-query / bad `--limit` / bad `--state` arms — confirming the
  CLI surface decodes the same `{ ok, tasks | reason }` envelope
  every visual client mirrors.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

The single docs touch (replacing the stale "fan-out to Telegram/
macOS/mobile is left to follow-up tasks" line in
`src/modules/repo-tasks/AGENTS.md` with the durable rule that the
shipped surface family speaks one bearer-auth `/tasks/search`
control route pinned by the cross-client conformance fixture)
lands in this same change. No follow-up tasks are warranted: the
contract is already pinned by the conformance gate, no foldable
decoder duplication exists, and no compatibility shim or
baseline-only ratchet from this fan-out batch is outstanding.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/task-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the four visual task-search surfaces — telegram (`/tasks <query>` rendered messages: usage hint for empty/whitespace-only query, `No matching tasks.` body, populated rendered table from the shared renderRepoTaskSearchPlain helper, and the semantic-unavailable caption), slack (`/tasks <query>` rendered against a workspace covering the same four arms), mobile (`TaskSearchScreen` covering the empty-query hint, populated hits inside the bodyCard with the typed badge, the `No matching tasks.` body, the orange `semanticBox` semantic-unavailable banner, the offline banner, and the error-with-retry state), and macOS (`TaskSearchBodyView` mounted in `AskUnifiedView` covering the empty-query hint, the populated monospaced hit list, the `No matching tasks.` line, the orange-foregrounded semantic-unavailable caption, the loading state, and the error/retry surface). Operator runs each client against a daemon (with and without an embedding-backed `tasks-semantic` provider configured) and commits the rendered artifacts under .kota/runs/task-consolidation-screens-<stamp>/{telegram,slack,mobile,macos}/. The daemon-side and CLI-side artifacts are already committed under .kota/runs/2026-05-02T23-03-38-854Z-builder-l9eg76/task-consolidation/.
```
