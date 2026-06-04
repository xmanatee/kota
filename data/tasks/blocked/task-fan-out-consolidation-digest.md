---
id: task-fan-out-consolidation-digest
title: Consolidate digest surfaces across clients
status: blocked
priority: p2
area: client
summary: Review the digest surface family across cli, daemon, macos, mobile, telegram, web for IA, contract consistency, duplicated rendering, runtime evidence, and accepted critic warnings now that the multi-client fan-out has shipped.
created_at: 2026-05-02T21:31:53.684Z
updated_at: 2026-05-07T00:00:00.000Z
---

## Problem

The `digest` capability shipped across 6 client surfaces
(cli, daemon, macos, mobile, telegram, web) without a holistic check on whether the surface family stayed coherent.
Per-surface tests passed, but coherence questions only make sense across the batch:
operator workflow fit, cross-client contract consistency, duplicated route/error/rendering
logic, provider readiness, runtime evidence, and accepted critic trade-offs.

## Multi-client fan-out batch

Capability: `digest`

Surfaces shipped:

- cli
- daemon
- macos
- mobile
- telegram
- web

Recently closed fan-out tasks in this batch:

- task-add-a-telegram-digest-command-that-emits-the-lates (telegram, closed 2026-04-26T02:56:42.868Z) — Add a Telegram /digest command that emits the latest daily-digest on demand
- task-add-kota-digest-cli-command-consuming-the-on-deman (cli, closed 2026-04-26T03:34:37.265Z) — Add kota digest CLI command consuming the on-demand digest seam
- task-add-daemon-http-digest-endpoint-consuming-the-on-d (daemon, closed 2026-04-26T04:06:51.653Z) — Add daemon HTTP digest endpoint consuming the on-demand digest seam
- task-add-web-client-digest-panel-consuming-apidigest (web, closed 2026-04-26T04:37:15.572Z) — Add web client digest panel consuming /api/digest
- task-add-macos-menu-bar-digestview-consuming-apidigest (macos, closed 2026-04-26T05:14:29.583Z) — Add macOS menu bar DigestView consuming /api/digest
- task-add-mobile-digestscreen-consuming-apidigest (mobile, closed 2026-04-26T05:47:32.102Z) — Add mobile DigestScreen consuming /api/digest
- task-add-push-notification-delivery-for-workflowdailydi (mobile, closed 2026-04-26T06:23:52.401Z) — Add push-notification delivery for workflow.daily.digest so mobile devices wake up on the cadence

## Desired Outcome

The `digest` surface family is reviewed end-to-end and either confirmed coherent
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

1. **Information architecture.** The `digest` capability is discoverable from
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

Auto-seeded by the fan-out-consolidator workflow after the `digest` capability
landed across 6 client surfaces between 2026-04-26T02:56:42.868Z
and 2026-04-26T06:23:52.401Z. The 2026-04-28 broad daemon review found that fan-out batches
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
`.kota/runs/2026-05-03T00-20-56-261Z-builder-2tvq2p/digest-consolidation/`:

- `contract-probe.json` — 7-arm runtime probe of `GET /api/digest`
  (the single shared route behind every web/macOS/mobile pull surface)
  plus the `renderOnDemandDigest` on-demand seam invariants. Arms:
  `success-explicit-windowEndMs` (200, with `text` + structured `data`
  byte-equal to the cadence `renderOnDemandDigest({ projectDir,
  windowEndMs })` output for the same window, pinning the full
  `DailyDigestData` shape every fan-out client decoder requires:
  `windowStartedAt`, `windowEndedAt`, `builderCommits`,
  `explorerAdditions`, `decomposerSplits`, `blockedPromoterMoves`,
  `failedMonitoredRuns`, `pendingOwnerQuestions`,
  `agingOperatorCaptures`, `queueDelta { current, previous, delta }`,
  `quiet`), `success-default-windowEndMs` (200 with `windowEndedAt`
  close to `Date.now()`), `malformed-windowEndMs-rejected` (400
  `{ error: "windowEndMs must be a finite number" }`),
  `unauthenticated-rejected` (401 from the daemon's shared auth
  middleware), `no-cadence-state-file-written` (`.kota/daily-digest-state.json`
  not written after on-demand calls — pins the on-demand seam
  invariant that mid-day pulls cannot corrupt the next 08:00 cadence
  delta), `no-workflow-daily-digest-emitted` (zero observed
  `workflow.daily.digest` events during on-demand calls — pins the
  invariant that mid-day pulls do not fan out as a duplicate cadence
  digest to telegram/slack/email/webhook/push), and
  `tolerates-wedged-runs-dir` (200 quiet body when `.kota/runs/` is a
  non-directory — pins the aggregator's first-run / fresh-deploy
  tolerance, so visual clients see the same quiet body they see when
  the autonomy loop has not run yet rather than a 500 decoder reject;
  the route's typed 500 `{ error: <msg> }` envelope at
  `digest-route.ts:52-54` remains a true unhandled-throw fallback,
  not a normal first-run path).
- `probe-contract.mjs` — the probe source kept alongside its artifact.
- `cli-transcript.txt` — `pnpm kota --help` discoverability (proves
  `digest` is in the top-level command inventory),
  `pnpm kota digest --help` flag inventory, live `pnpm kota digest`
  rendering against the live KOTA project store (text body), live
  `kota digest --json` envelope dump, and `jq`-extracted top-level +
  queueDelta key shape covering `windowStartedAt`, `windowEndedAt`,
  `quiet`, `queueDelta.current`, `queueDelta.previous`, and
  `queueDelta.delta`. Confirms the CLI surface decodes the same
  `DailyDigestData` shape every visual client mirrors.
- `verdict.md` — written verdict for each of the 8 consolidation
  dimensions.

The cross-client conformance gate already pins the wire shape
(`clients/conformance/contract-fixture.json` `digest` arm at
lines 420-486 plus the `parseDigestResponse` decoder at
`clients/conformance/decoders.ts:836-967`), exercised by web Vitest,
mobile Jest, and macOS Swift conformance suites.

Follow-ups filed (or named) in this change:

- `data/tasks/backlog/task-fold-conformance-decoders-into-mobile-digest-and-a.md`
  (new in this run, `area: client`, `priority: p3`) — the mobile
  client's production `getDigest` and `getAttention` paths use
  `daemonRequest<DigestResponse>` / `daemonRequest<AttentionResponse>`
  (TypeScript generic casts), while every per-store mobile search seam
  (recall, capture, retract, knowledge.search, etc.) already
  strict-decodes in production. macOS strict-decodes both via Swift
  Codable. The follow-up folds the conformance `parseDigestResponse` /
  `parseAttentionResponse` decoders into the mobile runtime so unknown
  fields throw at the mobile boundary instead of silently flowing into
  `DigestScreen` / `AttentionScreen` as typed-but-invalid objects.
- `task-fold-conformance-decoders-into-web-client-runtime-`
  (already filed, `backlog/`, `area: client`, `priority: p3`) — the
  parallel web-side asymmetry. Its `Done When` item 1 lists "Attention
  and digest endpoints run their matching parsers", so digest is
  already in scope of the existing task — no separate web follow-up
  is required.

The `src/modules/autonomy/workflows/daily-digest/AGENTS.md` "On-Demand
Seam" pull-surface inventory and "Relationship To attention-digest"
notification-subscriber inventory are updated in this change. The
pull-surface line now enumerates seven surfaces (Telegram, CLI,
slack-channel, daemon HTTP, embedded web, macOS, mobile) — the
slack-channel `/digest` slash command was missing despite consuming
the same on-demand seam through `DigestSnapshotClient.snapshot()`.
The notification-subscriber line now includes `push-notification`
alongside Telegram/Slack/email/webhook, since the push-notification
module subscribes to `workflow.daily.digest` and ships an Expo push
with `data.screen = "digest"` that wakes the mobile DigestScreen on
the cadence.

The closing fan-out commits (Telegram, CLI, daemon HTTP, web, macOS,
mobile, push-notification) were spot-checked for accepted critic
warnings; none rely on a markdown-description-instead-of-screenshots
substitution that needs a named retirement plan. The visual-evidence
gap on the macOS, mobile, web, telegram, and slack-channel surfaces
is captured by the operator-capture precondition below, not as a
separate retirement plan.

What is left is the per-surface visual evidence the autonomous
builder cannot capture headlessly.

## Unblock Precondition

```
kind: operator-capture
path: .kota/runs/digest-consolidation-screens-*
description: live operator-captured screenshots/screencasts for the live digest visual surfaces — telegram (`/digest` against a populated KOTA project store rendering the on-demand body the CLI transcript already shows from terminal — exercising the `Daily digest (<window>)` heading, the `Builder commits (...)` section with at least one row, the `Queue state` section with `ready` / `backlog` / `doing` / `blocked` deltas, and the plain-text-no-markdown rendering Telegram requires; plus `/digest` against a fresh / pre-autonomy project rendering the muted `No autonomy activity in this window.` quiet body), mobile (`DigestScreen` covering: the loading spinner, the populated `Daily Digest` title with the green `active` badge over a populated text body, the muted `quiet window` badge over the quiet body, the daemon-offline `Daemon offline — retrying every 15s` red banner, the `digestError` red error box with the Retry button, the pull-to-refresh RefreshControl mid-refresh, and the `No daemon configured.` empty state when daemon URL/token is unset), and macOS (`DigestView` menu-bar section covering: the collapsed header with `Daily Digest` caption + `doc.text.magnifyingglass` icon and the chevron, the expanded `Loading…` row with the small `ProgressView`, the populated `DigestBodyView` with the monospaced text body and `Refresh` button, the populated quiet vs active `DigestStateBadge` (muted `quiet window` vs green `active`), the `DigestErrorView` red copy with the bordered Retry button, and the `Tap to load digest` empty-cache hint), and web (`DigestPanel` sidebar section covering: the muted `Loading digest...` placeholder, the destructive error message + `Retry` outline button, the `No digest data` empty-data fallback, the populated body with the green `active` Badge or muted `quiet window` Badge, the optional `refreshing` muted span when re-fetching, and the `<pre>` mono body wrapped in the bordered/muted background block). CLI is excluded from this precondition because the headless transcript at `.kota/runs/2026-05-03T00-20-56-261Z-builder-2tvq2p/digest-consolidation/cli-transcript.txt` already covers every CLI arm (top-level discoverability, `--help` flag inventory, rendered text body, `--json` envelope, and `jq` key-shape extraction). Daemon is excluded because the runtime probe at `.kota/runs/2026-05-03T00-20-56-261Z-builder-2tvq2p/digest-consolidation/contract-probe.json` covers every `/api/digest` wire envelope arm and every on-demand seam invariant. Slack-channel is opportunistic, not required: the `/digest` slash command posts the same `renderOnDemandDigest` body Telegram emits, so the Telegram digest screenshots cover the chat-rendered shape both surfaces share. Push-notification is opportunistic, not required: the cadence push payload is `{ title: "KOTA daily digest", body: <text>, data: { screen: "digest" } }` per `src/modules/push-notification/index.ts:54-64`, exercised by the mobile DigestScreen captures (the captures already cover the deep-link target). Slack (Block Kit) is opportunistic, not required: the cadence webhook post mirrors the same `text` body the Telegram captures cover. Operator runs each visual client against a daemon configured (a) against a populated KOTA project store with at least one builder run and one queue movement so the active body and queueDelta render, and (b) against a fresh / pre-autonomy project so the quiet body renders, and commits the rendered artifacts under .kota/runs/digest-consolidation-screens-<stamp>/{telegram,mobile,macos,web}/.
```

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-06-04T03:18:14.605Z -->
