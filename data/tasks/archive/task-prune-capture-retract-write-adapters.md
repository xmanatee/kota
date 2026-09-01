---
status: done
---

# Consolidate capture, retract, and write adapters

## Scope / Starting Points

Inventory `src/modules/capture`, `retract`, affected stores, routes, local/daemon clients, CLI/tools/channels, provenance, authorization, atomicity, fixtures, and tests.

## Required Changes

- Name one owner for write validation, identity, authorization, atomic persistence, provenance, retraction targeting, not-found, and durable outcome.
- Use generated routine transport and direct domain result types.
- Retain adapters only for wire decoding, trust mapping, confirmation, rendering, or provider-specific persistence transforms.
- Delete forwarding wrappers, copied result arms, compatibility paths, reset hooks, and implementation-shaped fixtures.

## Must Not Complete While

Any behavior or file is unclassified, destructive semantics exist above the owner, or deleted tests are displaced into support code.

## Done When

The inventory has zero unresolved rows and authorization, atomicity, provenance, idempotency, retraction correctness, and recovery remain explicit at their owners.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Completion Evidence

| Behavior | Production owner | Authoritative files | Disposition / proof | Unresolved |
| --- | --- | --- | --- | ---: |
| Request validation and scope identity | Capture/retract route, agent-tool, and scope-context boundaries | `src/modules/capture/routes.ts`, `src/modules/capture/tool.ts`, `src/modules/capture/scope-context.ts`, `src/modules/retract/routes.ts`, `src/modules/retract/tool.ts`, `src/modules/retract/scope-context.ts` | Retained strict route decoding and one resolved store context per request; agent tools bind the selected session scope into provider requests, and malformed, missing, or unknown scope input is rejected before mutation. | 0 |
| Routine daemon transport | Generated daemon contract | `src/client/daemon-contract.ts`, `scripts/generate-daemon-contract-bindings.mjs`, `scripts/kota-client-typescript.mjs`, generated schema/TS/Swift outputs | Deleted handwritten daemon forwarding clients. Local clients consume direct result unions; generated daemon capture/retract clients decode unknown transport payloads through the generated route validators before returning domain results. Malformed discriminator and reason values are rejected through the generated client path, and the native decoder distinguishes task/inbox `write_failed` results from their narrower failure variants. | 0 |
| Capture selection | Capture provider | `src/modules/capture/capture-provider.ts`, `src/modules/capture/classifier-prompt.ts` | One closed target union; explicit targets bypass classification and abstention returns `ambiguous`. | 0 |
| Retraction targeting | Retract provider | `src/modules/retract/retract-provider.ts`, `src/modules/retract/client.ts` | One explicit `{ target, identifier }` request and exhaustive dispatch; no target-specific public request variants. | 0 |
| Cross-store persistence transform | Capture/retract modules | `src/modules/capture/store-writer.ts`, `src/modules/retract/store-retractor.ts` | One exhaustive transform per capability delegates to the selected domain owner. Provider options no longer expose persistence replacement hooks. | 0 |
| Memory identity, provenance, persistence, not-found, and recovery | Memory store | `src/modules/memory/store.ts`, `src/modules/memory/scope.ts`, `src/modules/memory/persistence.ts` | Identity/provenance remain store-owned. Every in-process scope resolver receives the same canonical store for a scope root, preventing stale capture/retract/recall snapshots. Save, update, and delete persist a candidate atomic snapshot before publishing it in memory; failed persistence leaves the prior in-memory snapshot intact. Decoder failures preserve malformed durable input and fail explicitly. | 0 |
| Knowledge identity, provenance, persistence, not-found, and recovery | Knowledge store | `src/modules/knowledge/store.ts`, `src/modules/knowledge/store-metadata.ts` | Creates and updates install a complete markdown record by atomic rename. Crash-left temporary files are outside the `.md` record set; delete uses atomic unlink. Identity lookup and provenance stay in the store. | 0 |
| Task/inbox validation, identity, authorization, durable outcome, and recovery | Repo-task mutation boundary and runtime-owned workflow | `src/modules/repo-tasks/repo-task-mutation-boundary.ts`, `src/modules/repo-tasks/repo-physical-file-mutations.ts`, `src/modules/repo-tasks/client.ts` | Capture/retract dispatch with canonical scope authority. Repo-tasks retains safe paths, resource authorization, rollback, and direct `RepoTaskMoveResult`; the retract-only copied result union was deleted. | 0 |
| Idempotency | Selected store/domain operation | Store and repo-task owners above | Task/inbox duplicates and repeated transitions preserve typed domain outcomes. Memory/knowledge capture intentionally mint fresh identities; no adapter invents cross-store idempotency. | 0 |
| Destructive confirmation and trust | Tool effect and effective scope policy | `src/modules/capture/tool.ts`, `src/modules/retract/tool.ts`, module prompt providers | Capture remains a write effect and retract remains destructive. Prompts gate on effective tool availability; presentation surfaces only decode, confirm, or render. | 0 |
| Fixtures and verification | Owning stores/providers and generated-contract integration | Co-located provider/store tests, `src/conversational-cross-store-fixture.integration.ts`, `src/daemon-contract-bindings.integration.test.ts`, `clients/apple/Tests/KotaSharedTests/DaemonContractGeneratedTests.swift` | Deleted contributor registries, forwarding-client suites, copied result-arm matrices, and test-owned runtime writers. Shared conversational and provenance fixtures pass real memory/knowledge stores through the production store transforms; the native regression exercises the generated Swift decoder where TypeScript verification cannot. | 0 |

All inventoried behavior and changed files have a disposition. Unresolved rows: **0**.
Each request selects exactly one persistence owner, so there is no cross-store
transaction; atomicity, not-found, and recovery belong to that selected owner's
mutation boundary.

Authored line counts classify every changed or newly authored implementation
path against `HEAD`; the terminal task-record move is excluded. Generated
daemon bindings are reported separately. `*.test.ts` is executable test code;
local `AGENTS.md`, the shared integration fixture, and integration test-support
files are authored support; remaining authored paths are production.

| Class | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 5,245 | 4,181 | -1,064 |
| Executable test | 10,058 | 5,785 | -4,273 |
| Authored support | 989 | 850 | -139 |
| Generated (excluded) | 7,838 | 8,028 | +190 |

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
