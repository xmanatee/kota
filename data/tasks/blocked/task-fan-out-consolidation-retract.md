---
id: task-fan-out-consolidation-retract
title: Consolidate retract surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the retract surface family across telegram, macos, mobile, web, daemon, cli, slack for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-03T00:46:48.615Z
---

## Problem

The `retract` capability shipped across 7 client surfaces
(cli, daemon, macos, mobile, slack, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `retract`

Surfaces shipped:

- cli
- daemon
- macos
- mobile
- slack
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-telegram-retract-command-consuming-the-cross-s (telegram, closed 2026-04-28T11:11:36.190Z) — Add Telegram /retract command consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (macos, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (mobile, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (web, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-web-retractpanel-consuming-the-cross-store-ret (telegram, closed 2026-04-28T11:38:21.473Z) — Add web RetractPanel consuming the cross-store retract seam
- task-add-macos-daemonclientretract-with-discriminated-r (macos, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-daemonclientretract-with-discriminated-r (mobile, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-daemonclientretract-with-discriminated-r (daemon, closed 2026-04-28T12:10:57.748Z) — Add macOS DaemonClient.retract with discriminated RetractResult types and unit tests
- task-add-macos-menu-bar-retractview-consuming-daemoncli (macos, closed 2026-04-28T13:11:10.301Z) — Add macOS menu-bar RetractView consuming DaemonClient.retract
- task-add-macos-menu-bar-retractview-consuming-daemoncli (mobile, closed 2026-04-28T13:11:10.301Z) — Add macOS menu-bar RetractView consuming DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (macos, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (mobile, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (telegram, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-add-mobile-retractscreen-consuming-a-new-daemoncli (cli, closed 2026-04-28T13:48:04.453Z) — Add mobile RetractScreen consuming a new DaemonClient.retract
- task-extend-slack-channel-slash-command-parity-to-retra (telegram, closed 2026-04-28T14:19:31.354Z) — Extend Slack-channel slash-command parity to /retract-<store> closing the chat-channel parity gap
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
landed across 7 client surfaces between 2026-04-28T11:11:36.190Z
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

The one drift surfaced by this review is the web client's runtime
posture (same shape the capture / digest reviews surfaced):
`clients/web/src/api/client.ts:326-331` calls `apiJson<RetractResult>`
(a TypeScript type assertion, not a runtime decoder), while
`clients/mobile/src/daemon/retract.ts:138-143` runs
`parseRetractResult` and
`clients/macos/Sources/KotaMenuBar/Daemon/RetractRoutes.swift:25`
strict-decodes via Swift `Codable`. The existing follow-up
`task-fold-conformance-decoders-into-web-client-runtime-` (already
in `backlog/`, `area: client`, `priority: p3`) explicitly lists
`api.retract` as a covered surface (Done When item 1: "`api.retract`
runs `parseRetractResult`"), so retract is already in scope of the
existing task. No new follow-up is required.

The `src/modules/retract/AGENTS.md` "Boundaries" section is updated
in this change. The stale "No fan-out from this module. Telegram,
web, macOS, and mobile adoption land later as their own honest
single-task follow-ups..." sentence is removed (the fan-out has
shipped). A new "Live consumers" section enumerates the seven shipped
surfaces and their daemon-route choice (macOS hits `/retract` not
`/api/retract`), and points readers at the conformance fixture for
the wire shape.

The closing fan-out commits for retract were spot-checked for accepted
critic warnings; none rely on a markdown-description-instead-of-
screenshots substitution that needs a named retirement plan. The
macOS and mobile task `## Acceptance Evidence` lines accepted
"transcript or screenshot" with the explicit `or`, so the
visual-evidence gap is captured by the operator-capture precondition
below, not as a separate retirement plan task.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/retract-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the live retract visual surfaces — telegram (`/retract` umbrella help body rendering plain text against an allowed chat, plus `/retract-memory <existing-id>` rendering the `Retracted: memory  <recordId>` success body, `/retract-knowledge <existing-slug>` rendering the `Retracted: knowledge  <recordId>` success body, `/retract-tasks <existing-task-id>` rendering the tasks success body with the `previousPath -> path (dropped)` "moved to dropped" wording, `/retract-inbox <existing-path>` rendering the `Retracted: inbox  <recordId>  <path>` success body, plus at least one `/retract-<target> <missing-id>` rendering the `Retract <target>: no record with identifier "<id>".` not_found body — all in plain text with no Markdown escaping, since the seam emits unescaped Markdown-active characters in identifiers and contributor errors), mobile (`RetractScreen` covering: the loading spinner, the populated success body with the green `retracted from <target>` header badge over the monospaced rendered body and per-target tinted success badge, the populated tasks success arm with the `dropped` toState badge and `previousPath → path` detail row, the populated `not_found` body with the orange `<target> not found` header badge over the muted body, the populated `contributor_failed` body with the red header badge over the destructive red body, the daemon-offline `Daemon offline — retrying every 15s` red banner, the per-target identifier-input chip selector showing `memory`/`knowledge`/`tasks`/`inbox` with the active chip highlighted, the destructive-styled `Confirm retract` two-step gate with the orange Confirm body and Cancel button, the `No daemon configured.` empty state when daemon URL/token is unset), and macOS (`RetractView` menu-bar section covering: the picker showing all four targets, the per-target identifier-label hint changing as the picker target changes, the `RetractControlsRow` two-submit gate showing the bordered `Retract` button on first submit and the destructive red `Confirm retract` + bordered `Cancel` on second submit, the populated `RetractResultView .success` row with target-tinted badge and monospaced `renderRetractResultPlain` body, the populated `.notFound` orange-tinted `RetractTargetedRow`, the populated `.contributorFailed` red-tinted `RetractTargetedRow`, the populated `.noContributors` orange caption, the `RetractErrorView` red copy with the bordered Retry button, and the `Retracting…` `ProgressView` mid-call), and web (`RetractPanel` sidebar section covering: the target Select listing the four targets in `RETRACT_TARGET_ORDER`, the per-target identifier Input with target-aware placeholder, the two-submit confirm gate with the destructive `Confirm retract` button and outline `Cancel`, the populated `RetractSuccessRow` with per-target Badge variant + monospaced recordId + per-target detail line (no detail for memory/knowledge, `dropped` Badge plus `previousPath → path` for tasks, `path` for inbox), the populated `not_found` row with target Badge plus muted "no record found" line, the populated `contributor_failed` row with target Badge plus destructive message line, and the `no_contributors` muted `Retract unavailable...` line, plus the React Query `retract.isError` destructive line when the network call itself throws). CLI is excluded from this precondition because the headless transcript at `.kota/runs/2026-05-03T00-37-54-559Z-builder-4u496g/retract-consolidation/cli-transcript.txt` already covers every CLI arm (top-level discoverability, `--help` flag inventory, every validation rejection, `not_found` for all four targets, `--json` envelope, and the `success-inbox` round-trip). Daemon is excluded because the runtime probe at `.kota/runs/2026-05-03T00-37-54-559Z-builder-4u496g/retract-consolidation/contract-probe.json` covers every wire envelope arm (request validation, success arms, failure arms, cross-target fallback invariant, route-level unhandled-throw). Slack-channel is opportunistic, not required: the `/retract-<target>` slash commands post the same `renderRetractResultPlain` body Telegram emits, so the Telegram retract screenshots cover the chat-rendered shape both surfaces share. Operator runs each visual client against a daemon configured against a populated KOTA project store with at least one live memory/knowledge/tasks/inbox record per target so the success arms render against real data, and at least one missing identifier per target so the `not_found` arm renders, and commits the rendered artifacts under .kota/runs/retract-consolidation-screens-<stamp>/{telegram,mobile,macos,web}/.
```
