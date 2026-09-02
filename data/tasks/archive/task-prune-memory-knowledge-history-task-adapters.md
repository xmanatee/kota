---
status: done
---

# Consolidate memory, knowledge, history, and task adapters

## Scope / Starting Points

Inventory `memory`, `knowledge`, `history`, `repo-tasks`, their semantic modules, routes, local/daemon clients, CLI consumers, result unions, caches, fixtures, and tests.

## Required Changes

- Assign validation, not-found, empty, semantic-unavailable, ranking, persistence, provenance, and retraction behavior to one named owner each.
- Consume generated transport, normalized collections, and `SemanticIndexManager` rather than forwarding wrappers.
- Retain adapter checks only for decoding, persistence mapping, identity, citation/provenance, and genuine transforms.
- Delete local/daemon mirrors, copied result arms, provider resets, compatibility paths, and implementation-shaped fixtures.

## Must Not Complete While

Any behavior or file is unclassified, any routine mapping remains handwritten, or deleted test LOC has moved into helpers/fixtures.

## Done When

The inventory has zero unresolved rows, each behavior has one owner and strongest observation, and one vertical journey covers only remaining composition risk.

## Acceptance Evidence

Provide the behavior/owner/file/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Completion Evidence

| Behavior | Production owner | Authoritative files | Disposition / strongest observation | Unresolved |
| --- | --- | --- | --- | ---: |
| Request and wire validation | Route decoders and generated daemon contract | `src/modules/{memory,knowledge,history}/routes.ts`, `src/modules/repo-tasks/routes-control.ts`, `src/client/daemon-contract.ts`, `scripts/daemon-contract-graph.mjs`, `scripts/kota-client-typescript.mjs` | Routes reject malformed public input. Routine list/add/search/reindex transports are generated from classified descriptors; generated search decoders reject malformed discriminators and result arms. | 0 |
| Normalized collections and empty results | Domain operation owners | `src/modules/memory/operations.ts`, `src/modules/knowledge/operations.ts`, `src/modules/history/operations.ts`, `src/modules/repo-tasks/repo-tasks-operations.ts` | Local clients and routes return the same canonical collections. Memory no longer invents an excerpt/tag list mirror; task listing owns dependency-wait projection once. Empty is the ordinary empty canonical collection. | 0 |
| Not-found and detail transforms | Domain operations, with exceptional daemon adapters | The operation files above; `src/modules/{memory,knowledge,history}/index.ts`; `src/modules/repo-tasks/daemon-client.ts` | Store misses become one domain result at the operation owner. Only genuine HTTP 404/detail-query/conflict transforms remain handwritten; forwarding-client suites and copied result-arm matrices were deleted. History API routes resolve their scoped provider directly and do not proxy or fall back across local/daemon paths. | 0 |
| Semantic-unavailable selection | Domain operation owners | The four operation files above | One capability check selects keyword or semantic behavior. Missing capability and task semantic failures return the namespace's explicit `semantic_unavailable` result; clients and routes do not repeat the policy. | 0 |
| Ranking and semantic lifecycle | `SemanticIndexManager` | `src/modules/semantic-index/semantic-index-manager.ts`; `src/modules/{memory,knowledge,history,tasks}-semantic/semantic-store.ts` | Manager retains index load, reconciliation, ranking, background-error handling, persistence, and reindex lifecycle. Semantic adapters retain only document fingerprints, filter mapping, hit mapping, and task sidecar identity; lifecycle-shaped adapter tests were removed. | 0 |
| Persistence, identity, and recovery | Memory, knowledge, history, and repo-task stores | `src/modules/memory/{store,persistence,scope}.ts`, `src/modules/knowledge/{store,store-metadata}.ts`, `src/modules/history/history.ts`, `src/modules/repo-tasks/{repo-tasks-domain,repo-file-mutations,repo-task-mutation-boundary}.ts` | Store tests remain the strongest persistence observation. Canonical per-scope resolvers prevent competing snapshots; the unused global knowledge/history singletons and production reset hooks were removed. | 0 |
| Provenance and citations | Store schemas plus semantic document mapping | Store owners above; `src/modules/{memory,knowledge}-semantic/semantic-store.ts`, `src/modules/recall/contributors.ts` | Durable provenance stays on canonical memory/knowledge records and survives list/search mapping. Semantic sidecars preserve source identity only; recall remains the citation presentation owner. | 0 |
| Retraction and deletion | Selected store/domain mutation | Store owners above; `src/modules/retract/store-retractor.ts` | Memory, knowledge, history, and task deletion target canonical identities and return owner-defined not-found outcomes. No adapter owns a second deletion or compatibility path. | 0 |
| CLI, route, and client consumers | Module client contracts and operation owners | `src/modules/{memory,knowledge,history,repo-tasks}/{client,index,routes-control}.ts`, CLI command files | CLI and visual/API consumers use module client contracts. Repo-task CLI's private multi-state collector and local/daemon behavior mirrors were removed; daemon list transport targets the normalized control route and preserves requested terminal states and transport failures. | 0 |
| Remaining composition risk | Generated decoder composed with an exceptional module adapter | `src/data-adapter-composition.integration.test.ts`, `src/daemon-contract-bindings.integration.test.ts` | One vertical journey assembles the shipped history daemon contribution, proves generated search success/rejection, and proves the adjacent authored 404 transform. Binding integration verifies descriptor/generator consistency. | 0 |
| Tests, fixtures, and caches | Owning behavior suites | Co-located store/route/semantic tests and manager tests | Deleted four forwarding-client suites and implementation-shaped semantic lifecycle fixtures. No deleted assertions moved into helper code. Scope caches retain only canonical provider identity; provider-reset APIs are gone. | 0 |

All inventoried behavior and changed files have a disposition. Unresolved rows:
**0**. Routine transport mappings are generated, while every remaining authored
adapter performs a domain transform that the transport generator cannot infer.

Authored line counts classify every changed implementation path against `HEAD`;
the terminal task-record move is excluded. `*.test.ts` and
`*.integration.test.ts` are executable tests; generator scripts and local
`AGENTS.md` files are authored support. Generated bindings and their manifest
are reported separately.

| Class | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 3,512 | 3,284 | -228 |
| Executable test | 8,279 | 6,006 | -2,273 |
| Authored support | 906 | 958 | +52 |
| Generated (excluded) | 2,840 | 2,930 | +90 |

## Initiative

Child of `task-prune-data-capability-adapter-tests`.
