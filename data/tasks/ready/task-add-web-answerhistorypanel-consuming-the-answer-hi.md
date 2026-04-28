---
id: task-add-web-answerhistorypanel-consuming-the-answer-hi
title: Add web AnswerHistoryPanel consuming the answer-history seam
status: ready
priority: p2
area: modules
summary: Add a sidebar AnswerHistoryPanel to the web client that consumes GET /api/answers + /api/answers/:id through DaemonControlClient.answer.log/show, so dashboard operators can scroll back through past synthesized answers and re-render any single record. Second-surface follow-up of the answer-history store after Telegram /answer-log + /answer-show; macOS and mobile adoption land later as separate tasks.
created_at: 2026-04-28T01:58:12.373Z
updated_at: 2026-04-28T01:58:12.373Z
---

## Problem

The answer-history store landed at commit `21bdc367` with the typed
`AnswerHistoryRecord` / `AnswerHistoryEntry` shapes, the disk-backed
store under `<projectStateRoot>/answer-history/`, append-on-every-arm
wiring inside `AnswerProviderImpl`, the `kota answer log` /
`kota answer show <id>` CLI subcommands, the `GET /api/answers` and
`GET /api/answers/:id` daemon routes (with control-plane twins), and
the `KotaClient.answer.log` / `KotaClient.answer.show` namespace
methods. The first single honest surface follow-up — Telegram
`/answer-log [N]` + `/answer-show <id>` — landed at commit `daa25e07`,
giving chat operators a way to scroll back through past synthesized
answers from the surface where most ad-hoc `/answer` queries
originate.

The web dashboard already exposes an `AnswerPanel` (commit `1d3dcefb`)
for composing new cited answers, but has no parallel surface for
reading back what the seam produced yesterday or last week. From the
dashboard the operator can compose new answers but cannot scroll
through history or re-render a stored record without dropping into
the CLI or the Telegram chat. That breaks the personal-assistant
promise on the surface that benefits from it: the dashboard is the
natural place to "what did I ask three days ago?" and to re-read a
synthesized answer in full alongside the live `AnswerPanel`.

The dashboard already uses the same `AnswerPanel`-next-to-`RecallPanel`
complementarity for the live composed-answer + source-pile pair.
History is the natural third panel — a read-back surface for the
typed records the seam now persists.

## Desired Outcome

`clients/web/src/components/sidebar/AnswerHistoryPanel.tsx` renders a
two-mode view powered by `DaemonControlClient.answer.log(filter?)` and
`DaemonControlClient.answer.show(id)`:

- **Log mode** — newest-first listing of `AnswerHistoryEntry[]`. Each
  row shows the timestamp, an ok/reason badge, the citation count for
  `ok: true` rows and the failure reason for `ok: false` rows
  (`no_hits` / `semantic_unavailable` / `synthesis_failed`), and a
  truncated query — the same one-line projection `kota answer log` and
  the Telegram `/answer-log` command already produce. Default limit
  matches the existing CLI / Telegram default. A "load older" affordance
  pages by passing `beforeId` to `answer.log` — same pagination shape
  the seam already exposes. Empty history shows a single fixed message
  ("No answers in history yet.").
- **Show mode** — full re-render of one selected record by id, fetched
  through `answer.show(id)`. Renders the discriminated `AnswerResult`
  exhaustively with no `default` branch, identical to how the existing
  `AnswerPanel` already renders a live response, plus a header line
  showing the record's `id` + `createdAt` + the original `query`. A
  back-affordance returns to the log view without re-fetching.
- Selecting a row in the log opens the show view for that id; the show
  view reuses the same exhaustive `AnswerResult` render the live
  `AnswerPanel` already uses (one shared sub-component if natural,
  otherwise the same render shape; do not invent a second citation
  parser or a second prose layout).
- The panel mounts in `Sidebar.tsx` next to the existing `AnswerPanel`
  so the live-compose and history-readback views sit side by side. The
  existing `AnswerPanel` stays unchanged.

## Constraints

- One mechanism. The panel consumes the existing
  `DaemonControlClient.answer.log` and `answer.show` namespaces exactly
  the way `AnswerPanel` consumes `answer.answer`; it does not introduce
  a second listing path, a second renderer, a second pagination shape,
  or a per-record fan-out into the underlying `RecallHit[]`. Listing
  pagination, the typed projection shape, and the discriminated
  `AnswerResult` union all come from the existing namespace.
- Strict typed protocols. The renderer consumes the seam's
  discriminated `AnswerResult` union exhaustively (`ok: true` and the
  three `ok: false` reasons) with no `default` branch, and consumes
  `AnswerHistoryEntry` / `AnswerHistoryRecord` directly without
  introducing optional-field shims. No `null | undefined` aliasing for
  the "no record" arm — `getAnswer` already returns `null` for missing
  ids and the panel renders that arm as a fixed message.
- Use `@tanstack/react-query` and the existing `DaemonControlClient`
  wrapper exactly like the other sidebar panels. No new HTTP layer, no
  raw `fetch` call against `/api/answers`.
- Reuse the existing `answer.log` / `answer.show` namespaces; do not
  bypass them to call the daemon routes directly.
- Reuse the existing sidebar panel layout and existing UI components
  (`Input`, `Button`, `Badge`). No new rendering primitives.
- Cost signals do not flow into the dashboard reply. Match the
  existing repo standing rule: no per-record cost surfaced into the
  panel.
- No legacy or compatibility shim. `AnswerHistoryPanel` ships as the
  only web surface for answer-history readback. The render shape is
  the only render shape; no opt-in flag, no v2 path.

## Done When

- A new `AnswerHistoryPanel` component exists at
  `clients/web/src/components/sidebar/AnswerHistoryPanel.tsx`, is
  mounted in `Sidebar.tsx` next to `AnswerPanel`, and consumes
  `DaemonControlClient.answer.log` + `answer.show`.
- Both modes render: log view shows the typed `AnswerHistoryEntry[]`
  with the same one-line projection the CLI and Telegram already use;
  show view re-renders `AnswerHistoryRecord` exhaustively across all
  four `AnswerResult` branches, with the header line for `id` +
  `createdAt` + `query`.
- Selecting a row from log opens show view for that id; the back
  affordance returns to log view.
- Empty-history and missing-id arms each render a distinct fixed
  message.
- Pagination wires through `answer.log({ limit, beforeId })` using the
  seam's existing parameter shape.
- A focused component test (`AnswerHistoryPanel.test.tsx`) covers:
  - Log render against a stub `DaemonControlClient` returning a typed
    `AnswerHistoryEntry[]` containing both `ok: true` and at least one
    `ok: false` arm.
  - Show render against a stub returning a typed
    `AnswerHistoryRecord` for each of the four `AnswerResult` branches.
  - Empty-log and missing-id arms.
  - Click-through from a log row into show view.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` are green for the web
  client.

## Source / Intent

Follow-on to commit `daa25e07` ("Add Telegram /answer-log and
/answer-show over the answer-history seam"), which finished the first
single honest surface for the answer-history store. The parent task
`task-persist-cited-answer-envelopes-as-a-typed-answer-h.md`
explicitly leaves web, macOS, and mobile adoption as separate
follow-up tasks. The web dashboard already exposes the live
`AnswerPanel` next to `RecallPanel`; an answer-history readback panel
closes the visible gap on the dashboard surface and keeps the
compose/readback complementarity consistent across surfaces.

## Initiative

Personal-assistant answering. KOTA should not just compose one cited
answer per query on every operator surface — the operator should be
able to read back past answers from the same surface they composed
them on. The web dashboard is the second natural surface (after
Telegram) for that readback because it is where the operator already
runs `/recall` and `/answer` from sidebar panels, and it is where the
seam's full prose + citation list renders best at width.

## Acceptance Evidence

- Diff for the new `AnswerHistoryPanel.tsx`, its sidebar mount, and
  the branch-coverage test file.
- Test output showing both log and show modes render against a
  stubbed client, including all four discriminated `AnswerResult`
  branches in show mode and a mixed `ok: true` / `ok: false` log.
- Optional screenshot capture under the run directory of the panel
  rendering against a live daemon, demonstrating the log view with
  at least one `ok: true` and one `ok: false` row, plus the show view
  for an `ok: true` record with at least two citations across two
  source arms.
