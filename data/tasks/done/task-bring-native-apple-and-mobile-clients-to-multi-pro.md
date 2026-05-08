---
id: task-bring-native-apple-and-mobile-clients-to-multi-pro
title: Bring native apple and mobile clients to multi-project selector parity
status: done
priority: p3
area: client
summary: Bring the apple (macOS + iOS) and mobile (React Native + Android) clients to project-selector parity once the daemon hosts multiple project runtimes and CLI/web have proven the contract.
created_at: 2026-05-08T00:01:21.756Z
updated_at: 2026-05-08T05:20:36.857Z
---

## Problem

The native apple shells (macOS menu-bar, iOS) and the React Native
mobile client (`clients/apple/`, `clients/mobile/`) consume the daemon
contract on `ClientIdentity` + the per-route handlers, all of which are
single-project today. After the daemon-foundation, CLI, and web tasks
land, the native clients lag — they will still render flattened state
for a daemon that hosts more than one project, breaking the contract
parity that `clients/AGENTS.md` requires.

This task picks up the native shells once the contract has been proven
on CLI and web. Per `clients/AGENTS.md`, apple and mobile share daemon
contract types and conformance fixtures, so this is one task — not two
duplicate tasks per platform.

## Desired Outcome

Apple (`clients/apple/`) and React Native mobile (`clients/mobile/`)
both render a project selector and project-scoped views backed by the
same registry endpoints the CLI and web clients consume. Per
`clients/AGENTS.md`, `apple/` owns macOS and iOS surfaces,
`mobile/` owns Android parity (and any other React-Native targets the
project decides to keep). Selectors share the same control-API
contract; the rendering layer is platform-native.

## Constraints

- Consume only the daemon control API. No `.kota/` reads, no
  client-side registry duplication.
- The contract conformance gate (`contract-fixture.json`,
  `client-contract.test.ts`, `ContractFixtureTests.swift`,
  `contract-fixture-cross-client.integration.test.ts`) must be updated
  in lockstep when this task ships, per `clients/AGENTS.md`.
- One task covers both surfaces. Do not split into separate apple and
  mobile follow-ups; they share the contract and the conformance gate.
- React Native mobile owns Android parity. Native iOS work belongs in
  `clients/apple/` unless the project formally retires the Swift iOS
  shell (which this task does not).
- The selector's behavior must match CLI and web — header position
  may differ per platform, but selection semantics, scope rules, and
  switching behavior do not.

## Done When

- Apple shells (macOS menu-bar + iOS) render the active project in
  their identity header and offer a typed selector that drives a
  project switch through the daemon control API.
- React Native mobile renders the same selector and per-project views.
- Project-scoped views (sessions, runs, approvals, owner questions)
  show one project's data at a time on every native shell.
- The contract conformance gate is updated in lockstep across TS and
  Swift fixtures.
- A `client-contract.test.ts`-equivalent assertion exists for the
  registry surface so future native clients inherit the typed
  selector for free.

## Source / Intent

Decomposition of `task-surface-project-selection-in-operator-clients-for-`
(Variant A, resolved 2026-05-07). Native parity follows the daemon
foundation and the first two operator surfaces (CLI, web), which prove
the contract before native shells consume it.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the
same daemon control contract.

## Acceptance Evidence

- macOS screenshot under `.kota/runs/<run-id>/` showing the menu-bar
  popover with the selector active and a project-scoped sessions list.
- iOS screenshot under `.kota/runs/<run-id>/` (or simulator capture)
  showing the same on a `WindowGroup`/`TabView` shell.
- React Native mobile screenshot or rendered DOM fixture showing the
  selector + per-project view.
- Contract-fixture diff and updated Swift/TS decoders.

Completed evidence:

- `.kota/runs/2026-05-08T05-03-17-068Z-builder-26wdzw/rendered-project-selector-states.txt`
  covers the Swift shared project-selector render states used by macOS/iOS.
- `.kota/runs/2026-05-08T05-03-17-068Z-builder-26wdzw/rendered-mobile-project-selector.json`
  covers the React Native mobile selector render state.
- The CLI daemon-mode selector remains a separate blocked follow-up
  (`task-add-cli-daemon-mode-project-selector-and-project-s`) because CLI
  event filtering depends on the still-blocked event-bus `projectId` slice.
