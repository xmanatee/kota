---
id: task-redesign-web-and-mac-around-operator-intents
title: Redesign Web and Mac around operator intents
status: ready
priority: p1
area: client
summary: Rebuild Web and Mac first screens around Status, Inbox, Work, Knowledge, and Setup instead of backend-seam navigation.
created_at: 2026-06-11T22:24:05.455Z
updated_at: 2026-06-18T18:16:16.847Z
task_class: Product
---

## Problem

Web and Mac currently expose too many backend nouns directly. The Web sidebar
is a long list of internal surfaces, and the Mac menu bar is better grouped
but still packed into a small command center. Neither client makes the
operator's first question simple: what is happening, what needs me, what work
exists, what knowledge exists, and what setup is missing?

## Desired Outcome

Rebuild the first-screen information architecture around five operator
intents shared with the CLI: Status, Inbox, Work, Knowledge, and Setup.

## Constraints

- Do not hand-redesign every backend surface independently before the shared UI
  protocol lands.
- Keep clients thin; they render daemon/client contracts and do not parse
  `.kota/` state directly.
- Preserve deep links or secondary access to existing surfaces where useful.
- Avoid hiding approvals, owner questions, or blocked work behind nested
  backend menus.

## Done When

- Web primary navigation is reduced to Status, Inbox, Work, Knowledge, and
  Setup, with old backend sections moved under those intents.
- Mac first view prioritizes Status and Inbox and uses the same intent model
  for deeper Work/Knowledge/Setup access.
- Blocked owner actions are visible in both clients.
- Shared fixtures or daemon projections back Status and Inbox instead of
  duplicated client-only aggregation.

## Source / Intent

Owner request on 2026-06-11: the Mac app and Web/server surfaces feel
overloaded, not clearly useful, and not designed from a human operator UX.

## Initiative

KOTA operator-first client simplification.

## Acceptance Evidence

- Web Playwright screenshot or HTML report shows Status and Inbox as the first
  primary surfaces.
- Apple rendered snapshot or screenshot shows Status and Inbox first.
- Client conformance fixture proves both clients consume the same Status/Inbox
  projection where available.
