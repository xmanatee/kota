---
id: task-redesign-web-and-mac-around-operator-intents
title: Align Web, Apple, and mobile around operator intents
status: done
priority: p1
area: client
summary: Rebuild Web, Apple, and mobile first screens around Status, Inbox, Work, Knowledge, and Setup instead of backend-seam navigation, while preserving secondary access to deeper surfaces.
created_at: 2026-06-11T22:24:05.455Z
updated_at: 2026-06-18T19:19:51.000Z
task_class: Product
---

## Problem

Web, Apple, and mobile have not converged on one operator-first information
architecture. The Web sidebar is still a long list of internal surfaces.
Mobile still exposes many backend-named tabs. Apple now has an
`OperatorSections.swift` grouping around operator intents, so it is further
along than Web/mobile, but it still needs verification against the shared
Status/Inbox projection and must not drift from the other clients.

The operator's first questions should be simple in every client: what is
happening, what needs me, what work exists, what knowledge exists, and what
setup is missing?

## Desired Outcome

Rebuild the first-screen information architecture around five operator intents
shared with the CLI: Status, Inbox, Work, Knowledge, and Setup. Web, Apple,
and mobile may use platform-appropriate layouts, but the primary intent model
and visible owner-action semantics should match.

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
- Mobile primary navigation is reduced to the same five intents, with deeper
  backend surfaces reachable secondarily instead of as top-level tabs.
- Apple first view is verified or adjusted so Status and Inbox are first-class
  and deeper Work/Knowledge/Setup access uses the same intent model.
- Blocked owner actions are visible in Web, Apple, and mobile.
- Shared fixtures or daemon projections back Status and Inbox instead of
  duplicated client-only aggregation.

## Source / Intent

Owner request on 2026-06-11 and follow-up audit on 2026-06-18: the Web,
Apple, and mobile surfaces feel overloaded or inconsistent when they expose
backend nouns before operator intents.

## Initiative

KOTA operator-first client simplification.

## Acceptance Evidence

- Web Playwright screenshot or HTML report shows Status and Inbox as the first
  primary surfaces.
- Apple rendered snapshot or screenshot shows Status and Inbox first.
- Mobile rendered fixture, screenshot, or navigation test shows the same five
  primary intents.
- Client conformance fixture proves Web, Apple, and mobile consume the same
  Status/Inbox projection where available.
