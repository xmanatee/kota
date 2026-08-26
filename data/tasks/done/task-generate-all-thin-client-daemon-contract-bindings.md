---
id: task-generate-all-thin-client-daemon-contract-bindings
title: Generate all thin-client daemon contract bindings
status: done
priority: p1
area: architecture
task_class: Platform
depends_on: [task-complete-the-terminal-project-to-scope-migration]
summary: Extend the canonical contract generator across daemon endpoints and remove hand-maintained TypeScript and Swift decoder mirrors.
created_at: 2026-07-31T16:00:58.607Z
updated_at: 2026-08-26T10:36:15.917Z
---

## Problem

The completed cross-client conformance task chose a shared fixture plus
hand-maintained decoder catalog. Web/core import that TypeScript catalog,
mobile keeps 17 byte-identical production copies, Apple mirrors Codable types,
and mobile/Apple package copied fixture resources. Conformance detects drift,
but the protocol still has several authored implementations.

## Desired Outcome

Extend the proven UI binding generator to every shared daemon endpoint so each
wire shape is authored once and emitted into strict TypeScript and Swift
bindings. Generate the typed `KotaClient` namespace aggregate outside neutral
core from those module-owned contracts. Keep fixtures as behavioral examples,
not as a substitute source of schema truth.

## Constraints

- Replace the copied-decoder convention documented in
  `clients/conformance/AGENTS.md`; no legacy/manual decoder path remains.
- Preserve client-specific transport and view models, but generate all shared
  wire envelopes, discriminators, nullability, and decode validation.
- Generated files/resources may exist per build system but must be regenerated
  deterministically and marked non-authoritative.
- Core retains only transport, authentication, event subscription, and generic
  namespace-registration protocols; it must not import module-owned client
  contracts through an exception allowlist.
- Do not change the public daemon API or add a second version solely to make
  generation easier.

## Done When

- Shared daemon route schemas have one canonical authored representation and
  generated TypeScript/Swift bindings used by web, mobile, and Apple.
- The byte-copied mobile conformance directory and manually mirrored Swift
  wire types are removed or replaced entirely by generated output.
- Adding/changing a route contract updates one source and stale client output
  fails the generation check.
- The generated client aggregate replaces the hand-authored core namespace
  array, and the `#modules/*` core import exception is deleted.
- Strict negative conformance cases remain for unknown reasons, sources,
  targets, and every discriminated response family.

## Source / Intent

2026-07-31 audit: all 17 `clients/conformance/decoder-*.ts`/catalog files are
byte-identical to mobile production copies; both JSON fixtures are duplicated,
and Apple maintains separate Swift mirrors. This follows the prior task's
conformance choice but does not satisfy the owner's stronger requirement that
there be one implementation of each contract.

## Initiative

One canonical capability mechanism per KOTA boundary.

## Acceptance Evidence

- A generated contract manifest mapping every daemon route family to its
  canonical schema and emitted web/mobile/Swift binding.
- Two consecutive generation runs with identical hashes, plus a deliberate
  schema change that fails stale-output validation in all clients.
- A structural search proving authored decoder mirrors and manually copied
  conformance implementation files no longer exist.

## Result

The daemon wire contract now has one TypeScript-authored graph covering the
protocol version, routes, response families, events, capabilities, aliases,
and the generated `KotaClient` namespace host. Deterministic generation emits
JSON Schema, strict TypeScript runtime decoders for conformance and mobile,
Swift wire models, capability metadata, client assembly, and freshness
manifests. Web, mobile, Apple, local, and daemon clients consume those outputs;
native rendering and semantic request helpers remain platform-owned.

The handwritten decoder catalog, mobile byte copies, three 9.5k-line contract
fixtures, hand-authored Swift wire mirrors, core aggregate client, its module
import exception, and fixture-parity tests were removed. Small generated UI
behavior vectors now cover renderer semantics that schema cannot express.
The stage removed over forty thousand maintained lines while retaining strict
negative decoding for unknown discriminators and response families.

Freshness checks, lint, production and test typechecks, and the production
build passed. Twenty focused generator, decoder, and client-owner checks
passed; web passed 29 focused checks, mobile passed 76, and Apple passed all
239 tests. A temporary-source generation check changes a representative
optional error field and observes changed schema, conformance TypeScript,
mobile TypeScript, and Swift output hashes, while a structural inspection found
no remaining authored decoder mirror, copied giant fixture, old core aggregate,
or neutral-core module-client import.
