---
status: open
priority: p1
depends_on: [task-generate-daemon-client-transport-bindings, task-centralize-semantic-index-lifecycle]
---

# Consolidate recall, answer, and read adapters

## Scope / Starting Points

Inventory `src/modules/recall`, `answer`, relevant document/read providers, routes, local/daemon clients, CLI/tool consumers, citations, semantic-unavailable handling, fixtures, and tests.

## Required Changes

- Name one owner for query validation, source resolution, semantic availability, citation/provenance, not-found, and answer assembly.
- Use generated routine transport and direct domain result types.
- Retain adapters only for meaningful query transforms, provider mapping, wire decoding, or rendering.
- Delete forwarding wrappers, copied result unions, local/daemon parity matrices, provider resets, and lifecycle fixtures.

## Must Not Complete While

Any behavior or file is unclassified, any surface repeats the domain result matrix, or test code is displaced into support data.

## Done When

The inventory has zero unresolved rows and retained surface scenarios each name a failure not caught at the domain owner.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

### Completed inventory

| Behavior | Owner | Files | Disposition |
| --- | --- | --- | --- |
| Untrusted recall/answer request decoding | Recall wire boundary | `src/modules/recall/query.ts`, recall/answer `routes.ts` | Retained one shared decoder; removed copied route filter catalogs. Blank-query and unknown-scope HTTP tests remain because those failures occur at the wire boundary. |
| Source identity and source-filter resolution | Recall domain | `recall-types.ts`, `recall-provider.ts` | Retained `RECALL_SOURCE_ORDER` plus `isRecallSource`; CLI/tool/routes consume them instead of copying source lists. |
| Scope selection | Recall and answer domain providers | `recall-provider.ts`, `answer-provider.ts`, co-located `scope-context.ts` | Moved selection behind each provider; routes and local clients only pass `scopeId`. Typed selection errors are the HTTP mapping seam. |
| Semantic availability | `RecallProviderImpl` | `recall-provider.ts` | Provider now returns `RecallResult` and solely emits `semantic_unavailable`; removed route, local-client, and tool contributor pre-checks. |
| Recall query execution, normalization, and ranking | `RecallProviderImpl` | `recall-provider.ts` | Retained domain behavior and direct result; callers no longer wrap hit arrays into parallel result envelopes. |
| Answer failure classification and assembly | `AnswerProviderImpl` | `answer-provider.ts`, `citation-parser.ts` | Provider implements the complete `AnswerClient`, including answer/log/show. Recall-unavailable, no-hits, synthesis failure, and not-found are no longer rebuilt by routes or local adapters. |
| Citation validation and persisted provenance | Answer domain/history | `answer-provider.ts`, `answer-history-store.ts`, `recall-contributor.ts` | Retained typed citation resolution and records. Answer recall hits now expose only query/preview/citation count/time; deleted their copied `AnswerResult` union. |
| Answer failure wording and hit rendering | Rendering owner | answer/recall `render.ts`, CLIs/tools/channel consumers, `clients/conformance/recall-render-fixture.json` | Retained meaningful render transforms and one answer-failure wording catalog; removed per-surface result matrices and JSON/render parity tests. |
| Routine local/daemon transport | Generated client contract | `scripts/daemon-contract-graph.mjs`, `scripts/daemon-contract-typescript.mjs`, generated daemon bindings | Recall and all answer operations use generated routine descriptors and direct domain response types. Removed the obsolete generated `RecallAnswerHitResult` alias and local forwarding/store replicas. |
| Provider lifecycle | Module provider registry | recall/answer `index.ts` | Removed ambient active-provider/history globals and reset fixtures. Late-bound tools, routes, and local clients resolve typed registered providers; only the meaningful cross-module contributor unregister remains. |
| Document format selection and extraction failures | Read-document extractor map/tool boundary | `read-document.ts`, `read-document-extractors.ts` | Retained request/path validation, provider mapping, output provenance, and failure translation. Consolidated two suites into scenarios for distinct public failures; removed copied provider cases and host-platform resets. |
| Cross-surface and support fixtures | Domain owners plus generated/conformance contracts | owner, integration, eval, Telegram, and resource-discovery consumers | Updated direct-result consumers. Deleted the checked-in historical `reference-evidence` transcript/screenshot tree; executable behavior remains in owner/integration tests and generated contracts. |

Every inventoried behavior and file has an owner and disposition; there are no
unresolved rows. Retained surface tests distinguish failures outside the domain
owner: wire decoding/status mapping, CLI option transforms/rendering/exit codes,
tool schema/render bridges, generated binding drift, cross-client rendering,
scope isolation, and document command selection/exhaustion.

### LOC evidence

The audited scope is all files under `src/modules/{recall,answer,read-document}`.
Production is non-test TypeScript; executable tests are `*.test.ts`; authored
support is scoped `AGENTS.md`, the removed recall `reference-evidence` tree, and
the recall conformance fixture. Machine-generated artifacts are excluded from
authored LOC and checked by their generator.

| Category | Before | After | Change |
| --- | ---: | ---: | ---: |
| Production | 4,590 | 4,460 | -130 |
| Executable tests | 3,627 | 2,635 | -992 |
| Authored support | 1,710 | 226 | -1,484 |

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
