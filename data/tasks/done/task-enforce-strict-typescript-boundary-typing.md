---
id: task-enforce-strict-typescript-boundary-typing
title: Enforce strict TypeScript boundary typing
status: done
priority: p1
area: architecture
summary: Define and enforce a repo policy that eliminates explicit any and confines unknown to validated boundary decoders, so protocol surfaces stay strongly typed instead of relying on casts.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-29T06:47:16.980Z
---

## Problem

The repo is `strict: true`, but `biome.json` still disables
`suspicious.noExplicitAny` and `suspicious.noImplicitAnyLet`. A targeted scan
on 2026-04-28 found only a few production explicit `any` escapes, but many
`unknown` / `Record<string, unknown>` boundary casts across clients, MCP,
workflow execution, provider seams, and route handlers.

The owner's instinct is correct that stronger type pressure forces cleaner
protocols. The professional caveat is that `unknown` should not be forbidden
globally: it is the right type for untrusted JSON, caught errors, and adapter
raw input. The gap is that KOTA does not yet distinguish allowed boundary
`unknown` from type-system escape hatches inside trusted protocol code.

## Desired Outcome

The codebase has an enforceable TypeScript boundary policy:

- Explicit `any` is removed from production code or constrained to documented,
  local exceptions for untyped third-party modules.
- `unknown` is allowed at untrusted boundaries only: JSON parse, HTTP input,
  SSE/MCP frames, caught errors, external SDK frames, fixture loaders, and
  schema/decoder entry points.
- Values cross from `unknown` into domain code only through named decoders,
  type guards, schemas, or discriminated unions.
- New modules that expose protocol data declare exported types or schema-backed
  decoders that dependents must consume directly.

## Constraints

- Do not blindly replace `unknown` with concrete casts. Runtime input must
  remain treated as untrusted until validated.
- Do not introduce a second type system for every internal object. Use schemas
  where data crosses a persistence, process, network, client, or model
  boundary.
- Prefer Biome rules where they are enough. Add a focused repo-local guard only
  for the KOTA-specific "unknown only at boundaries" rule if existing tooling
  cannot express it.
- Tests and fixtures may need narrower exceptions, but production exceptions
  must be few, named, and justified.

## Done When

- Production explicit `any` uses are gone or have local documented exceptions
  with an issue/task reference.
- `biome.json` or an equivalent guard fails on new explicit `any` in
  production TypeScript.
- A repo-local check reports raw `unknown` / `Record<string, unknown>` usage
  outside approved boundary files or approved decoder functions.
- At least three existing boundary-heavy areas are migrated to the new pattern:
  one client decoder, one module/provider protocol, and one workflow or MCP
  protocol.
- Scoped `AGENTS.md` guidance documents when `unknown` is required and how it
  must be narrowed.

## Source / Intent

Owner request on 2026-04-28: "I feel like we should properly forbid any and
unknown in the codebase and not allow it and this way force agents to figure
out proper types and maintain them cleanly and nicely... maybe each module
could declare their types if necessary and then their dependents would be
forced to use them properly."

Owner amplification on 2026-04-29
(`data/inbox/protocols-for-all-comms.md`, captured pointing back at this
task): "There should be strict typing everywhere! E.g. for every endpoint
there should be strict type definition (e.g. using zod or protobuf or
anything similar) so that if protocol changes all the clients of the
endpoints or users of the endpoint break and must be updated to support
the change! basically with this typesafety i want to make ci a lot more
robust and reliable. on every change we should run some tests and if
protocol changes which affects many clients or users it must be caught
early and all the inconsistencies resolved. duplicate types and mixing of
abstracts/concepts must be avoided! Also protocols must be as strict as
possible! every time a new type is added or updated it should be
thoroughly reviewed: They shouldn't be too allowing! nullability shouldn't
be default! it should be there only in cases where it's actually
relevant! All the main params must not be nullable! That should be kinda
best practices for the repo... maybe some critic could know that to
always direct builder in the right direction! basically right and clean
and clear abstractions and protocols are VERY important for correct
architecture and robustness and reliability and investing into keeping
them such is EXTREMELY important!"

This expands the scope from "no any, unknown only at boundaries" to also:

- Every daemon control endpoint, channel transport, and module-public
  protocol surface ships a single shared schema/type definition that all
  clients import directly. CI must fail when a protocol change is not
  reflected in every consumer.
- No duplicate or near-duplicate types for the same wire concept across
  daemon, modules, native clients, and tests. One owning module per
  concept; consumers import.
- Nullability is opt-in, not default. Required parameters are
  non-nullable; optional fields are explicit and justified per
  `AGENTS.md` strictness rules.
- A reviewing critic role (e.g. the existing critic or an architect-mode
  judge) is given enough signal to push back on lax type additions during
  builder runs. Coordinate with the open critic/judge tasks instead of
  introducing a parallel reviewer.

The wire-contract sharing/conformance angle overlaps with
`task-share-or-conformance-test-daemon-wire-contracts-ac` (already in
backlog). Resolve the overlap when scheduling: this task owns the
language-level strictness policy and the schema-source-of-truth rule;
the wire-contract task owns conformance testing across clients. Keep
both pointed at the same shared schema artifact.

Investigation evidence:

- `tsconfig.json` has `"strict": true`.
- `biome.json` currently sets `suspicious.noExplicitAny` and
  `suspicious.noImplicitAnyLet` to `off`.
- Targeted production scan found explicit `any` escapes in
  `src/modules/daemon-ops/qr-cli.ts`, `src/core/modules/module-loader.ts`, and
  `src/core/daemon/notification-gate.ts`.
- Broad scan found many `unknown` boundary casts, especially in
  `clients/mobile/src/daemonClient.ts`, `src/modules/mcp-server/server.ts`,
  workflow step executors, route handlers, and fixture loaders.

External references checked:

- TypeScript Handbook on `unknown`: safer than `any` because it must be
  narrowed before use.
- TypeScript Handbook on discriminated unions and `never` exhaustiveness.
- typescript-eslint `no-explicit-any` and `no-unsafe-*` rule family.
- Zod's TypeScript-first schema validation model as one possible boundary
  decoder pattern, not a mandated dependency.

## Initiative

Protocol hardening: make type safety a mechanical architecture property so
module, workflow, client, and daemon contracts drift less often and agents are
forced into explicit decoders instead of casts.

## Acceptance Evidence

- A before/after artifact showing explicit `any` counts and approved
  `unknown` boundary counts.
- The new lint/guard fails on a deliberately introduced production `any`.
- The new guard fails on an unapproved `unknown` cast in trusted domain code.
- `pnpm typecheck`, `pnpm lint`, and the relevant migrated-area tests pass.

