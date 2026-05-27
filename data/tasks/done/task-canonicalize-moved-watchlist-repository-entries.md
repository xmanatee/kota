---
id: task-canonicalize-moved-watchlist-repository-entries
title: Canonicalize moved watchlist repository entries
status: done
priority: p2
area: autonomy
summary: Teach explorer watchlist updates to detect repository redirects or moved-project notices and converge on one canonical URL per resource so stale aliases do not waste exploration cycles or duplicate snapshots.
created_at: 2026-05-27T11:32:45.428Z
updated_at: 2026-05-27T11:46:53.907Z
---

## Problem

`data/watchlist.yaml` treats each `url` as the stable resource identity. That
works until a project moves repositories. Explorer then keeps monitoring the
old alias even when the canonical destination is different or is already
tracked separately.

The current watchlist has three concrete shapes:

- `https://github.com/badlogic/pi-mono` redirects to
  `https://github.com/earendil-works/pi`.
- `https://github.com/block/goose` redirects to
  `https://github.com/aaif-goose/goose` and the README says the project moved
  from `block/goose` to AAIF.
- `https://github.com/mannaandpoem/OpenManus` is a one-commit pointer to
  `https://github.com/FoundationAgents/OpenManus`, while the FoundationAgents
  URL is already a separate watchlist entry.

That leaves stale snapshots and duplicate monitoring decisions in the
explorer's input. It also makes the "changed" fingerprint noisy: the old alias
can change because of redirect or pointer-page churn rather than because the
resource KOTA cares about changed.

## Desired Outcome

Explorer has one explicit watchlist canonicalization path for moved repository
entries. When a fetched watchlist resource resolves to a durable canonical URL,
or when the fetched content is only a moved-project pointer to another tracked
resource, the watchlist converges on one resource identity instead of keeping
stale aliases alive indefinitely.

The result should be operator-auditable:

- If the canonical target is not yet tracked, the watchlist records or replaces
  the entry so future runs monitor the canonical target.
- If the canonical target is already tracked, the stale alias is removed or
  marked in a way the inspector no longer treats as a resource to refresh.
- Historical context is preserved in a short note or snapshot summary; do not
  silently drop why the URL changed.
- `inspect-watchlist` exposes canonicalized entries without forcing the
  explorer agent to rediscover redirect history each run.

## Constraints

- Keep `data/watchlist.yaml` human-editable and minimal. If a new field such as
  a canonical URL or replaced-by marker is needed, update the strict parser and
  serializer instead of accepting arbitrary YAML.
- Do not add a second watchlist database or sidecar redirect registry.
- Do not remove genuinely useful old URLs just because a host responds with an
  HTTP redirect. Only converge when the canonical target is a durable project
  identity or the old page is only a move notice.
- Preserve inaccessible-source honesty: failed fetches still become
  `status: inaccessible`, not guessed redirects.
- Keep the implementation inside the autonomy explorer watchlist path unless a
  narrower shared URL-normalization helper is already present.

## Done When

- Watchlist parsing and serialization support the chosen canonicalization shape
  with strict field validation.
- Applying watchlist updates can canonicalize a fetched moved repository entry
  without duplicating snapshots or losing operator notes.
- `inspect-watchlist` no longer presents stale moved aliases as ordinary
  refresh candidates once they have a canonical tracked target.
- Focused tests cover:
  - redirect-only canonicalization such as `badlogic/pi-mono` ->
    `earendil-works/pi`;
  - moved-notice canonicalization such as `mannaandpoem/OpenManus` ->
    `FoundationAgents/OpenManus`;
  - the already-tracked-target case, proving duplicate watchlist entries do
    not survive;
  - ordinary unchanged entries continuing to round-trip unchanged.
- The live `data/watchlist.yaml` entries for the moved repositories are
  canonicalized through the new path.

## Source / Intent

Explorer run `2026-05-27T11-28-55-916Z-explorer-u6eaia` found an empty
actionable queue. The surfaced strategic blocked alternatives all still require
operator-captured artifacts and are not movable, so the right queue-shaping
action is a focused autonomy/watchlist task instead of another blocked
operator-capture item.

External sources checked during the run:

- `https://github.com/badlogic/pi-mono` currently redirects to
  `https://github.com/earendil-works/pi`.
- `https://github.com/block/goose` currently redirects to
  `https://github.com/aaif-goose/goose`, whose README states the project moved
  from `block/goose` to AAIF.
- `https://github.com/mannaandpoem/OpenManus` states that the OpenManus project
  moved and points readers to `https://github.com/FoundationAgents/OpenManus`.

Local evidence:

- `data/watchlist.yaml` already tracks `FoundationAgents/OpenManus` separately
  while retaining the stale `mannaandpoem/OpenManus` pointer page.
- `src/modules/autonomy/workflows/explorer/watchlist.ts` currently validates
  only `url`, `added`, `notes`, `status`, and `snapshot`; any canonicalization
  field must be added deliberately.
- `src/modules/autonomy/workflows/explorer/watchlist-updates.ts` applies
  updates by exact URL, so redirect targets cannot converge with the tracked
  URL today.

## Initiative

Autonomous discovery quality: explorer should spend attention on current
primary resources, not stale aliases or duplicate moved-project snapshots.

## Acceptance Evidence

- Focused test transcript for explorer watchlist parsing, update application,
  and inspection behavior, for example
  `pnpm test src/modules/autonomy/workflows/explorer/watchlist.test.ts`.
- `pnpm run validate-tasks` transcript showing the queue remains valid with
  this task moved out of `ready/`.
- Diff showing the moved watchlist entries canonicalized without adding a
  parallel watchlist state file.
