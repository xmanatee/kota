---
id: task-fan-out-consolidation-retract
title: Consolidate retract surfaces across clients
status: done
priority: p2
area: client
summary: Review the retract surface family across macos, mobile, slack, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-06-18T17:33:40.700Z
---

## Problem

The `retract` capability shipped across 5 client surfaces
(macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `retract`

Surfaces shipped:

- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-retract-command-consuming-the-cross-s (telegram, closed 2026-04-28T11:11:36.190Z) — Add Telegram /retract command consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (web, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-macos-daemonclientretract-with-discriminated-r (macos, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-menu-bar-retractview-consuming-daemoncli (macos, closed 2026-04-28T13:11:10.301Z) — Add macOS menu-bar RetractView consuming DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (mobile, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-extend-slack-channel-slash-command-parity-to-retra (slack, closed 2026-04-28T14:19:31.354Z) — Extend Slack-channel slash-command parity to /retract-<store> closing the chat-channel parity gap

## Desired Outcome

The `retract` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `retract` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `retract` capability
landed across 5 client surfaces between 2026-04-28T11:11:36.190Z
and 2026-04-28T14:19:31.354Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-03T00-37-54-559Z-builder-4u496g/retract-consolidation/`:

- `contract-probe.json` — 15-arm runtime probe of `createRetractRouteHandler`
  (the single shared handler behind both `POST /retract` daemon-control and
  `POST /api/retract` user-facing routes) covering every typed envelope every
  fan-out client decodes:
  - boundary validation: `missing-target-rejected`,
    `unknown-target-rejected`, `missing-identifier-{memory,knowledge,inbox}-rejected`,
    `malformed-body-rejected` (all 400 with the typed error envelope)
  - success arms: `success-memory`, `success-knowledge`,
    `success-tasks-with-path-and-state` (pinning the
    `previousPath -> path (dropped)` shape and `toState: "dropped"`
    literal every visual client decoder requires), `success-inbox-with-path`
  - failure arms: `no-contributors-arm`, `not-found-arm` (with typed
    target+identifier echoed back), `contributor-failed-arm` (with typed
    target+verbatim message), `seam-never-falls-back` (no implicit
    cross-target retry — pins the retract-AGENTS.md routing invariant)
  - transport-level: `provider-throws-unhandled` (500 with typed `{ error }`
    envelope, distinct from the typed `contributor_failed` arm)
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — `pnpm kota --help` discoverability (proves
  `retract` is in the top-level command inventory), `pnpm kota retract
  --help` flag inventory, every CLI validation arm (missing/unknown
  target, missing per-target identifier, cross-arg validation), the
  `not_found` arm against the live KOTA project store for all four
  targets, `--json` envelope mode on `not_found`, plus a
  capture-then-retract inbox round-trip showing the `success-inbox`
  arm with the `--json` envelope (with disposable inbox note created
  and removed in the same transcript so the live KOTA project store
  is left clean).
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

The cross-client conformance gate already pins the wire shape
(`clients/conformance/contract-fixture.json` `retract.{successMemory,
successKnowledge,successTasks,successInbox,noContributors,notFound,
contributorFailed,negative_unknownTarget,negative_unknownReason}` plus
the `parseRetractResult` decoder at
`clients/conformance/decoders.ts:445-548`), exercised by web Vitest,
mobile Jest, and macOS Swift conformance suites.

The one drift surfaced by this review was the web client's runtime
posture. That follow-up,
`task-fold-conformance-decoders-into-web-client-runtime-`, is now
done; `clients/web/src/api/client.ts` calls
`apiDecoded("/api/retract", parseRetractResult, ...)`, matching the
strict mobile parser and Swift `Codable` route decoder.

The `src/modules/retract/AGENTS.md` "Boundaries" section now reflects
the shipped cross-surface consumers and points durable wire-shape detail
back to code and conformance tests instead of preserving future-fan-out
language.

The closing fan-out commits for retract were spot-checked for accepted
critic warnings; none rely on a markdown-description-instead-of-
screenshots substitution that needs a named retirement plan. The
macOS and mobile task `## Acceptance Evidence` lines accepted
"transcript or screenshot" with the explicit `or`, so the
visual-evidence gap is captured by the operator-capture precondition
below, not as a separate retirement plan task.

Per-surface visual evidence is recorded in the committed completion artifact below.

## Status (2026-06-15 blocked audit)

The stale screenshot/operator-capture blocker was replaced by local rendered evidence during the 2026-06-15 audit. That local artifact was ignored by the repository run rules, so the close-out copied the relevant evidence into the committed current-run artifact below.

## Promotion Evidence

Committed evidence now lives under
`.kota/runs/2026-06-18T17-26-31-452Z-builder-mr1cmu/retract-consolidation/`:

- `rendered-evidence/web/retract-panel-operator-states.html` and `rendered-evidence/web/retract-panel-operator-states.json` — rendered HTML snapshot fixture from the real web `RetractPanel` after its confirmation flow, covering success, `no_contributors`, `not_found`, and `contributor_failed` result arms;
- `rendered-evidence/mobile/retract-screen-rendered-tree-manifest.json` plus the per-state `rendered-evidence/mobile/retract-screen-*.json` fixtures — React Native rendered tree snapshot fixtures from the real mobile `RetractScreen`, covering confirmation, success, unavailable, not-found, contributor-failed, and offline states;
- `rendered-evidence/macos/rendered-menu-bar-states.txt` and `rendered-evidence/macos/swift-client-tests.txt` — macOS menu-bar snapshot state and Swift retract validation;
- `rendered-evidence/telegram/chat-rendered-replies.txt` — Telegram command-body rendering from the shared chat helper;
- `rendered-evidence/slack/chat-rendered-replies.txt` — Slack command-body rendering from the same shared chat helper;
- `contract-validation-results.txt` — focused route, CLI, cross-client fixture, web, mobile, and Apple contract validation from this run.

## Completion Review (2026-06-18)

The close-out review is recorded at
`.kota/runs/2026-06-18T17-26-31-452Z-builder-mr1cmu/retract-consolidation-completion-review.md`.
No new follow-up task is needed. Fresh focused validation covered the retract
module route/CLI/client/tool tests, the cross-client contract fixture guard,
the web retract panel and decoder boundary, the mobile retract screen and
fixture suite, and the Apple retract view and fixture suites. The same run now
commits the rendered/operator evidence needed for Done When 5 and the
Acceptance Evidence section. Chromium and Quick Look screenshot capture were
blocked by the local macOS sandbox during the repair, so the web close-out uses
the committed rendered HTML snapshot fixture instead of claiming a PNG.
