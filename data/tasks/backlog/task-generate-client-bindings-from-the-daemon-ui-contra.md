---
id: task-generate-client-bindings-from-the-daemon-ui-contra
title: Generate client bindings from the daemon UI contract
status: backlog
priority: p1
area: architecture
task_class: Platform
summary: Generate strict TypeScript and Swift ui.surface.v1 bindings from one canonical daemon contract instead of hand-maintained decoders.
created_at: 2026-07-31T16:00:54.498Z
updated_at: 2026-07-31T16:00:54.498Z
---

## Problem

`ui.surface.v1` is defined in `src/core/daemon/ui-surface.ts`, then manually
redeclared in `clients/conformance/decoder-ui-*.ts`, copied byte-for-byte into
`clients/mobile/src/daemon/conformance/`, and mirrored again in
`clients/apple/Sources/KotaShared/ContractTypes.swift`. The fixture guard proves
the copies match today, but every protocol change still requires multiple
implementations and synchronization steps.

## Desired Outcome

Make the daemon UI contract the only authored schema and generate the strict
TypeScript and Swift bindings consumed by web, Android/mobile, Apple, and
conformance tooling. Generated artifacts may be checked in or packaged where
platform tooling requires it, but they are never hand-edited sources of truth.

## Constraints

- Replace the current copied decoder mechanism; do not keep generation and
  hand-written mirrors as two supported paths.
- Preserve discriminated unions, strict unknown-arm rejection, nullability,
  action/result schemas, and useful field-path decode errors.
- Use the repo's existing TypeScript-to-JSON-Schema capability where suitable;
  add one deterministic generation command and ownership location, not a
  separate schema per client.
- Do not generate visual components. This task owns wire bindings only.

## Done When

- One canonical source generates the `ui.surface.v1` schema plus TypeScript and
  Swift bindings.
- Web/mobile import or consume generated TypeScript bindings, Apple consumes
  generated Swift bindings, and hand-maintained UI decoder/type mirrors are
  deleted.
- The generation command is deterministic and a stale generated artifact is
  rejected mechanically.
- Positive and negative conformance fixtures exercise every UI node, action,
  readiness, permission, and unknown discriminator through generated decoders.

## Source / Intent

The 2026-07-31 single-mechanism audit found 17 byte-identical TypeScript
decoder/catalog files plus two fixture copies under mobile, alongside the
separate Swift mirror. `clients/conformance/AGENTS.md` explicitly requires
copying these files. The owner requested one definition with platform-specific
rendering, not several maintained implementations.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A generation manifest/artifact listing the canonical input and every emitted
  TypeScript/Swift output with stable hashes from two consecutive runs.
- Conformance output showing generated bindings accept the canonical fixture
  and reject deliberate unknown node/action arms on every client platform.
- A search artifact showing no authored `decoder-ui-*` copy or hand-written
  Swift `UiSurface` protocol mirror remains.
