---
id: task-surface-owner-question-queue-in-web-and-native-cli
title: Surface owner-question queue in web and native clients
status: backlog
priority: p2
area: clients
summary: Web dashboard, macOS MenuBarExtra, and mobile app already surface approvals but not owner questions. Add pending-question panels that list, answer, and dismiss questions via the existing /api/owner-questions endpoints.
created_at: 2026-04-16T07:47:18.494Z
updated_at: 2026-04-16T07:47:18.494Z
---

## Problem

The daemon exposes `/api/owner-questions` with list, answer, and dismiss
endpoints. The CLI (`kota owner-question …`) is the only operator surface
today. The three client apps — web dashboard (`clients/web`), macOS
MenuBarExtra (`clients/macos`), and mobile React Native app (`clients/mobile`)
— all surface the `ApprovalList` / `ApprovalsView` / `ApprovalListScreen`
equivalents but have no counterpart for owner questions. A question raised
during an autonomous run is effectively invisible to an operator away from
the terminal.

## Desired Outcome

Each client renders a pending-owner-question panel with parity to the
existing approvals panel:

- Web: a new sidebar panel component (e.g. `OwnerQuestionsPanel.tsx`) that
  lists pending questions with context, reason, source, and proposed
  answers; answer and dismiss actions call the existing endpoints; SSE-driven
  live updates via `owner.question.changed` / `asked` / `resolved`.
- macOS: a MenuBarExtra view (mirroring `ApprovalsView.swift`) with inline
  answer/dismiss actions.
- Mobile: a screen (mirroring `ApprovalListScreen.tsx`) with answer/dismiss
  actions and navigation parity with the approvals flow.
- Shared API client layer (where each client already has one) gains typed
  `listOwnerQuestions`, `answerOwnerQuestion`, `dismissOwnerQuestion`
  helpers.

## Constraints

- Clients remain thin — no new daemon or server changes; rely on the existing
  `/api/owner-questions` routes and SSE events.
- Use each client's existing patterns (React + TanStack Query for web,
  SwiftUI with polling/SSE for macOS, React Native + existing daemon client
  for mobile). Do not introduce new state-management or networking libs.
- Keep authentication and token handling identical to the approvals flow.
- Do not expand the owner-question HTTP surface — if a missing endpoint is
  discovered, file a follow-up task rather than patching from the client.

## Done When

- All three clients display pending owner questions in real time.
- Answer and dismiss actions round-trip through the HTTP API.
- Each client has at least a minimal test for the API layer added.
- CI continues to pass for each client.
