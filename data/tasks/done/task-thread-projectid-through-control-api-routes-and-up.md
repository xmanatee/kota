---
id: task-thread-projectid-through-control-api-routes-and-up
title: Thread projectId through control-API routes and update conformance decoders
status: done
priority: p2
area: architecture
summary: Thread projectId scope through every daemon control-API route that lists or mutates project-scoped state, expose ProjectRegistryProjection on GET /identity (or successor), and update contract-fixture + TS + Swift decoders in lockstep.
created_at: 2026-05-08T00:57:06.775Z
updated_at: 2026-05-08T04:10:05.991Z
---

## Problem

The daemon control API is single-project today. `GET /identity` returns
`projectName` + `projectDir` as singular fields; route handlers for
sessions, runs, approvals, owner questions, and metrics implicitly scope
to one project. Once the daemon hosts more than one project (foundation
slice + per-project bundle factory + projectId on event payloads), the
control API has to expose the registry and accept a `projectId` parameter
on every list/subscribe/mutate route that touches project-scoped state.

Clients (CLI, web, native) cannot render a project selector without
project identity on the wire, and the contract-conformance suite (TS +
Swift decoders + shared `clients/conformance/contract-fixture.json`) must
move in lockstep so all clients adopt the contract together.

## Desired Outcome

`ClientIdentity` carries the `ProjectRegistryProjection` (default
projectId + ordered list of configured projects) so a client can render a
selector without reading `.kota/` files or hardcoding daemon URLs. Every
control-API route that lists or mutates project-scoped state accepts a
`projectId` parameter and returns project-scoped data. Routes that span
projects (registry listing, daemon health) return a typed shape that
names the scope explicitly.

The contract conformance gate updates the shared
`clients/conformance/contract-fixture.json`, the TS decoders in
`clients/conformance/decoders.ts`, and the Swift `Codable` decoders in
the macOS `ContractFixtureTests.swift` together. All client conformance
suites pass against the new fixture.

## Constraints

- One daemon-owned control protocol. No client-side project registry, no
  multi-daemon façade.
- Strict typed scope. Routes that touch one project require `projectId`;
  routes that span the daemon expose a distinct shape.
- The contract conformance gate (contract-fixture + TS + Swift decoders +
  cross-client integration tests) is updated in lockstep, per
  `clients/AGENTS.md`.
- KOTA-on-itself with one configured project still produces the same
  observable output for `kota status`, `kota session`, identity probes.
- This task does not implement client-side selectors — those land in the
  CLI, web, and native parity follow-ups. This task only stabilizes the
  contract every client consumes.

## Done When

- `ClientIdentity` (or a sibling endpoint) returns the typed
  `ProjectRegistryProjection`.
- Every control-API route that lists or mutates project-scoped state
  accepts a `projectId` parameter and returns scoped data.
- Cross-project routes (registry listing, daemon-wide health) return a
  distinct typed shape rather than ambiguous flat lists.
- `clients/conformance/contract-fixture.json`, the TS decoders in
  `clients/conformance/decoders.ts`, and the Swift decoders in the macOS
  `ContractFixtureTests.swift` are updated together.
- Every conformance suite (web Vitest, mobile Jest, daemon Vitest, macOS
  Swift) passes against the new fixture.
- A daemon transcript captured under `.kota/runs/<run-id>/transcript.txt`
  shows `kota status` plus a `GET /identity` response on a daemon
  configured with two projects.

## Source / Intent

Decomposition slice 4 of the daemon foundation for multi-project
supervision (parent:
`task-surface-project-selection-in-operator-clients-for-`, foundation:
`task-add-daemon-project-registry-and-projectid-attribut`). Builds on the
registry primitive, the per-project bundle factory, and the event-bus
projectId scope. Unblocks the CLI, web, and native client tasks already
in `blocked/`.

## Initiative

Multi-project operator supervision: one daemon hosts project-scoped
runtimes and every operator client sees project identity through the same
daemon control contract.

## Acceptance Evidence

- The contract-fixture diff that adds the `ProjectRegistryProjection`
  shape and the matching TypeScript + Swift decoders parsing the fixture.
- A daemon transcript under `.kota/runs/<run-id>/transcript.txt` showing
  `kota status` and `GET /identity` against a two-project daemon.
- All four conformance suites green against the new fixture.
