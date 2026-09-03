---
status: done
---

# Make module lifecycle conformance structural

## Scope / Starting Points

Inventory `src/core/modules`, `src/core/modules/testing`, every module definition and scoped module suite for registration enabled/disabled, metadata literals, setup requirements, client/route contributions, effects, workflow contributions, lifecycle/reset behavior, catalogs, source absence, and numbered part files.

## Required Changes

- Make `ModuleDefinition`, schema validation, loader admission, generated clients, and host lifecycle the sole structural owners.
- Add shared conformance only for cross-cutting guarantees selected from capabilities declared by the module.
- Keep canonical declarative values inspectable at source instead of copying literals into assertions.
- Delete per-module wiring/catalog/presence/source-shape tests, migration exports, compatibility aliases, duplicate local/daemon branches, reset APIs, and numbered fixture families after ownership moves.
- Retain module suites only for semantic behavior or declared capability exceptions.

## Must Not Complete While

Any module/test family is unclassified, any checker requires undeclared optional behavior, any structural fact is copied into a literal snapshot, or any compatibility/reset path remains without a current consumer.

## Done When

The module/capability/file inventory has zero unresolved rows; invalid declarations fail at schema/loader/generator/host admission; routine modules have no tests restating names, metadata, wiring, or absence of old source.

## Acceptance Evidence

Provide the module/capability/disposition matrix, invalid-declaration observations, and before/after production, executable-test, and authored-support LOC.

### Module / Capability / Disposition Matrix

Runtime discovery produced 93 bundled module declarations. Every row is resolved; counts are the modules that declare the optional capability (an omitted capability is valid and creates no conformance obligation).

| Inventory surface | Declared modules | Structural owner | Disposition |
| --- | ---: | --- | --- |
| Identity | 93 names, 82 versions, 91 descriptions | `KotaModule` and `assertModuleDefinition` | Runtime-decoded before dependency sorting; module-local literal assertions removed. |
| Dependencies | 65 | Definition decoder and loader dependency graph | Non-empty, trimmed, unique, non-self dependencies admitted structurally; load ordering remains loader-owned. |
| Configuration | 5 `configSlices`, 12 `configSchema` | Definition decoder, config-slice registry, setup service | Shape admitted only when declared; readiness and secret-resolution behavior retained. |
| Events | 9 | Event declarations and loader event authority | Declaration shape remains canonical; emission, filtering, and security behavior retained. |
| Tools | 27 | Typed tool definitions, manifest/effect validation, loader | Tool-list and metadata catalogs removed; execution, effect escalation, and availability behavior retained. |
| Commands | 37 | Definition decoder and loader command assembly | Presence, option, and alias catalogs removed; parse/output behavior retained. The obsolete `automation` alias was deleted; `workflow` and `wf` remain the owned surface. |
| Public/control routes | 31 / 27 | Definition decoder, route factories, daemon host collision/auth rails | Route-list snapshots removed; HTTP authentication, decoding, response, and collision behavior retained. |
| Workflows | 6 | Typed workflow definitions and loader validation | Presence catalogs removed; semantic triggers, resources, routing, and outcomes retained. |
| Channels | 4 | Typed channel definitions and channel host | Channel-name catalogs removed; readiness, delivery, filtering, and cleanup behavior retained. |
| UI surfaces | 18 | Generated UI bindings and loader assembly | Generated freshness remains authoritative; rendered projection behavior retained. |
| Skills / agents | 9 / 1 | Typed declarations and loader assembly | Presence/path catalogs removed; prompt/tool-policy and execution behavior retained. |
| Agent harnesses | 8 shipped modules / 9 production adapters | Declarative `agentHarnesses`, definition decoder, loader lifecycle, exact-registration disposer | Imports are side-effect free; commands/runtime loaders register adapters on load and withdraw only their own registrations on unload. The eval replay adapter conditionally shadows and restores the production adapter through the same stack. |
| Effects / setup requirements / manifests | 3 / 9 / 17 | Typed schemas, manifest validator, setup service | Literal catalogs removed; risk gating, readiness, secret resolution, and rejection behavior retained. |
| Local clients | 29 | Generated client contract plus loader assembly | Namespace presence tests removed; exceptional semantic transforms remain authored. |
| Daemon clients | 17 authored exceptions; routine bindings generated | Canonical daemon contract graph, generator, generated aggregate, loader | Namespace/method presence tests removed; request mapping remains only for named security, timeout, binary, local-process, or status-transform exceptions. Modules contribute handlers and cannot declare inert parallel operation descriptors. |
| Activation / health | 55 `onLoad`, 2 `healthCheck` | Loader and host-owned `ModuleActivation.dispose` lifecycle | Duplicate local unload assertions removed; resource release, failure isolation, reverse disposal, and health behavior remain at the owning layer. |
| Compatibility exports and resets | 3 unused core-state re-export groups removed | Core domain owners and host disposers | Approval, owner-decision, and owner-question migration re-exports were deleted. Remaining reset functions are either test-support APIs with consumers or host disposer implementations. |
| Numbered suites | 20 approval-queue, 9 Slack, 10 Telegram files | Their module semantic owners | Classified and retained: they cover approval authorization/races, Slack command/render behavior, and Telegram polling/callback/delivery behavior. Their structural presence/catalog assertions and one stale compatibility mock were removed; no lifecycle ownership was moved out of those semantic cases. |

### Invalid-Declaration Observations

`ModuleLoader` now invokes `assertModuleDefinition` before event authority or activation, while discovery invokes it before config-slice registration. Owner tests observe rejection with no loaded module for a non-object declaration, missing name, blank name, unknown compatibility or retired operation field, route array where a factory is required, malformed channel and agent entries, duplicate dependencies, and a self dependency. Static contribution arrays and factory results pass capability-shaped decoders. Command, public-route, and control-route outputs are decoded before caching, and a non-void activation must expose a disposer. Workflow contents stay under the canonical workflow validator after loader metadata attachment; loader admission accepts both watch-only and webhook-only triggers. Event admission invokes the canonical recursive schema decoder, including field and filter-path membership and uniqueness. Tool and config schema admission invokes the canonical open object-schema envelope decoder without restricting JSON Schema keywords. Local and daemon client factory results are decoded against generated namespace and method descriptors before the host consumes them. `loadAll` keeps each installed declaration inside per-module failure isolation so a malformed optional extension cannot prevent bundled modules from loading. Existing capability validators continue to reject malformed declared tool/effect/event/workflow/manifest internals, while generated freshness checks prove UI and daemon-client artifacts remain derived from their canonical sources.

### Initial Builder Before / After LOC

Measured against `HEAD` across the changed `src/` surfaces, excluding this task record:

| Surface | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 6,637 | 7,870 | +1,233 |
| Executable tests | 25,769 | 24,808 | -961 |
| Authored support | 203 | 210 | +7 |

The production increase is the runtime declaration decoder, capability-envelope validators, and host-owned harness registration lifecycle, net of removed aliases and migration exports. The test reduction deletes structural catalogs while preserving semantic suites and focused admission/lifecycle observations.

### Verification

- `pnpm typecheck` passed production and test TypeScript.
- `src/core/modules/module-loader.test.ts`: 86 owner tests passed, including all invalid-declaration observations.
- `src/module-loader-lifecycle-mode.integration.test.ts`: the discovered 93-module commands-mode lifecycle scenario passed.
- Changed pure owner suites: 438 tests passed. The combined run's remaining 72 live HTTP tests could not bind loopback sockets in the managed sandbox (`listen EPERM`); their failures occurred in setup before assertions, so the existing passing type/lifecycle evidence is the available proof for those source-only test deletions.
- `pnpm check:client-bindings` passed generated UI/client freshness checks.
- Biome checks passed on the changed structural surfaces.

Post-check repair added direct runtime probes for malformed declaration rejection, installed-module failure isolation, exact harness registration disposal, and restoration of shadowed registrations. A source scan confirms production module files no longer call `registerAgentHarness` at import time, and `bun src/validate-queue.ts` passes task integrity. The original builder verification above preceded the repair. In the managed repair workspace, dependency executables were unavailable, the lockfile predates the newly declared TypeScript dependency, and the offline mirror lacked current metadata, so the focused Vitest and project typecheck commands could not be rerun; dependency-free Deno probes exercised the production decoder, registry, and `ModuleLoader` paths instead.

Post-check repair attempt 2 removed the parallel workflow trigger decoder and added owner cases for canonical watch/webhook validation plus malformed command, route, control-route, and activation results. Node's TypeScript syntax checks and scoped diff whitespace checks pass. The focused Vitest and project typecheck commands remain unavailable because this isolated worktree has no dependency installation and the frozen lockfile does not match `package.json`.

Post-check repair attempt 3 made the remaining adapter integration suites explicitly register only the harness they exercise and removed their copied shipped-harness catalogs. It also routed event declarations through the recursive event-schema validator and generated client-factory admission from the daemon operation graph. Dependency-free runtime probes reject duplicate or schema-absent event fields, malformed nested nodes, unknown client namespaces, and missing namespace methods. The checked-in aggregate exactly matches `generateKotaClientAggregate()`, and its manifest source/output hashes match. Full Vitest, Biome, project typecheck, and the combined bindings command remain unavailable in this isolated worktree: dependency executables resolve outside its permitted filesystem and `ts-json-schema-generator` is not installed locally.

Post-check repair attempt 4 completed agent-harness structural admission for every optional capability and nested unsupported-option declaration. The decoder now rejects unknown harness fields, invalid cancellation quarantine values, non-callable readiness/auth/step/model hooks, malformed option arrays and entries, unknown option fields, and run-option keys outside the type-derived canonical catalog. A dependency-free runtime probe rejected all 12 malformed variants and admitted a complete valid declaration; Node TypeScript syntax checks and scoped diff whitespace checks pass. Focused Vitest and project typecheck remain unavailable because their executables resolve to the permission-blocked parent dependency tree.

Post-check repair attempt 5 closed the remaining declaration-admission gaps: agent and nested tool-policy decoders reject unknown fields, tool input and output schemas require the canonical object shape, and `loadAll` isolates nullish installed declarations without reading their identity outside its failure boundary. Focused owner cases cover each rejection and prove valid bundled modules still load beside malformed optional declarations. The agent decoder passed a dependency-free runtime probe; Deno type-checking of that owner and Node TypeScript syntax checks of every changed repair surface passed. Scoped diff whitespace checks also pass. The focused Vitest, Biome, and project typecheck commands remain unavailable because their executable shims resolve to the permission-blocked parent dependency tree.

Post-check repair attempt 6 made load-failure evidence source-bearing rather than name-keyed, rejects duplicate module identities before topological sorting, and preserves a successfully admitted bundled module when a malformed installed declaration reuses its name. Route and channel contribution decoders now reject unknown nested fields, including obsolete `enabled` metadata. The remaining Vercel, Codex, Gemini, Thin, OpenAI-tools, Claude, and Antigravity declaration/capability snapshots were removed while their behavioral adapter, readiness, policy, streaming, and registry-dispatch coverage remains. Node TypeScript syntax checks passed across every repair surface, the channel admission runtime probe rejected unknown metadata, `bun src/validate-queue.ts` passed, the targeted source scan found no remaining adapter capability-property assertions, and scoped diff whitespace checks passed. Focused Vitest, Biome, project typecheck, and Deno project checking remain unavailable because dependency resolution points outside the permitted worktree or requires blocked network access.

Post-check repair attempt 7 made failed-load rollback contribution-instance-aware and local-client namespace registration atomic, so a rejected module cannot remove an earlier workflow/channel owner or leak handlers collected before a collision. Skill registration now rejects ownership collisions before mutating shared projections. Capability admission rejects unknown fields on skill, event, config-slice, operation, tool, UI-surface, and effect envelopes, including nested operation parameters, event examples, schema-source records, tool records, and effect declarations. Module config and tool input/output schemas are recursively decoded as closed JSON Schema structures rather than admitted by shallow object checks. Focused owner cases cover both rollback failures and obsolete capability/schema metadata. Dependency-free Deno runtime probes observed the declaration rejections and atomic local-client collision behavior; Deno checking reported no errors in the changed repair surfaces before reaching unavailable external dependencies and unrelated project diagnostics. Node TypeScript syntax checks, scoped diff whitespace checks, and `bun src/validate-queue.ts` pass. Focused Vitest remains unavailable because its executable resolves to the permission-blocked parent dependency tree.

Post-check repair attempt 8 moved pipe dispatch inside the CLI's commands-mode module lifecycle. `main()` now admits bundled and installed declarations through `ModuleLoader.loadAll()` before `checkPipeMode()` can resolve an agent harness, and a `finally` block withdraws the loaded contributions after pipe execution, command execution, or failure. This restores piped harness execution without reintroducing adapter import side effects. Node's TypeScript syntax check, a direct source-order/lifecycle inspection, scoped diff whitespace checks, and `bun src/validate-queue.ts` pass. Focused Vitest and the built CLI probe remain unavailable because this worktree has no local package executables or resolvable `commander` dependency.

Post-check repair attempt 9 removed the unused `KotaModule.operations` declaration, resolver, decoder, and type file; the daemon contract graph is now the only operation-descriptor source consumed by client generation. JSON Schema admission moved beside the canonical open `KotaToolInputSchema` contract and validates only its object envelope plus JSON compatibility, so standard and extension keywords such as `readOnly`, `$comment`, and `definitions` remain admissible. A focused owner case covers open config/input/output schemas and top-level rejection of the retired operation field. Deno type-checking and a runtime decoder probe pass, as do Node TypeScript syntax checks and scoped diff whitespace checks. The focused Vitest command remains unavailable because its executable resolves to the permission-blocked parent dependency tree.

Post-check repair attempt 10 made config-slice ownership exact across loader hosts: structural discovery registration is idempotent and atomic, loader acquisition returns a per-host disposer, ownership collisions reject before mutation, and rollback no longer removes another module's slice. Foreign transports now remain explicit pending candidates until loader admission, are discarded on every rejected admission, and close on handshake failure. Module-source attribution is committed with successful lifecycle admission, so a colliding foreign candidate cannot relabel a valid bundled module. Focused Deno runtime probes observed independent config leases, collision rejection, final withdrawal, and pending foreign shutdown; a production `ModuleLoader` probe additionally observed the rejected foreign failure summary, preserved bundled attribution, and subprocess shutdown marker. The config registry passes standalone Deno type-checking, Node TypeScript syntax checks pass across every repaired owner surface, `bun src/validate-queue.ts` passes, and scoped diff whitespace checks pass. Focused Vitest and the project typecheck remain unavailable because this worktree has no local dependency executables and the package-manager shim resolves to the permission-blocked parent tree.

Post-check repair attempt 12 removed the last identified module-suite catalogs: inbound-signals no longer copies event names, scopes, fields, filter paths, policies, or route literals; Gemini CLI no longer snapshots harness identity and routine capabilities; and attention-digest no longer carries a registration/name-only suite. The Gemini registry integration still proves streamed messages by observing them, and attention-digest retains detector, renderer, route, CLI, and cross-workflow behavioral coverage. Node TypeScript syntax checks, a targeted residual-catalog scan, `bun src/validate-queue.ts`, and scoped diff whitespace checks pass. Focused Vitest remains unavailable because its executable resolves to the permission-blocked parent dependency tree.

Post-check repair attempt 14 made the runtime composition helper unload its owned `ModuleLoader` whenever aggregate discovery or admission rejects, so earlier activations, providers, tools, and event listeners cannot outlive a failed host initialization. A focused owner regression observes activation disposal, provider withdrawal, and listener cleanup after a later bundled module fails. The remaining copied tool-name, effect, group, required-field, and schema-enum assertions were removed from the Google Workspace, notebook, system, recall, answer, guardrails-audit, resource-discovery, and replay-tool fixture suites; their runner, validation, transport, and durable-effect observations remain. Node TypeScript syntax checks pass for every repaired source, the targeted residual-catalog scan is clean, `bun src/validate-queue.ts` and scoped diff whitespace checks pass. Focused Vitest and project typecheck remain unavailable because their executables are absent from this worktree or resolve to the permission-blocked parent dependency tree.

Post-check repair attempt 15 completed the scope client graph with all authority and onboarding operations and removed the undeclared handler-exemption path, so generated client admission rejects a scopes handler that cannot serve the live CLI and UI surface. Host-owned decoders now validate both module health hook result shapes: malformed runtime checks become `unhealthy`, while malformed lifecycle projections fail before reaching module summaries. Exact GitHub, Google Workspace, and Linear tool-count assertions were replaced with secret/config-driven availability observations. A transformed-TypeScript runtime probe observed incomplete scope-handler rejection; direct health probes observed valid propagation and malformed-result rejection; the generated aggregate matches `generateKotaClientAggregate()`, every binding-manifest source/output hash matches, Node syntax checks pass on all repaired sources, the targeted count/exemption scans are clean, `bun src/validate-queue.ts` passes, and scoped diff whitespace checks pass. The full bindings generator, focused Vitest, and project typecheck remain unavailable because `ts-json-schema-generator` is absent and dependency executables resolve to the permission-blocked parent tree.

Post-check repair attempt 18 moved foreign-manifest structural admission into the handshake cleanup boundary. The host now rejects the KEMP-required tool list when it is not an array, projects array entries into the canonical `KotaModule` shape, and invokes `assertModuleDefinition` before returning a connected session. Malformed identity, metadata, tool, or schema declarations therefore close their transport before a pending candidate, ping timer, or death watcher can escape. A focused subprocess case observes rejection, shutdown, and no resilient restart for a non-array tool list. A dependency-free production probe observed both container and canonical nested-tool rejection with exactly one shutdown and close per session. Node TypeScript syntax checks, `bun src/validate-queue.ts`, and scoped diff whitespace checks pass. Focused Vitest, Biome, and project typecheck remain unavailable because their executable shims resolve to the permission-blocked parent dependency tree.

Post-check repair attempt 19 removed the residual route and effect declaration copies from the agent-ops, scheduler, web, capture, retract, secrets, and execution suites while retaining handler outcomes, guardrail routing, approval, scope propagation, and traversal-defense observations. Module-event teardown now has one lifecycle mechanism: exact registration leases owned by loader disposers; the unused bulk `unregisterModule` compatibility path and its private-method test were deleted. A dependency-free runtime probe observed two concurrent event leases, preservation after the first disposal, and withdrawal after the final disposal. Node TypeScript syntax checks pass on every repaired source, the targeted residual route/effect and bulk-removal scans are clean, `bun src/validate-queue.ts` passes, and scoped diff whitespace checks pass. Focused Vitest cannot start because its executable resolves to the permission-blocked parent dependency tree; Deno project checking reaches the same unavailable dependency boundary at `better-sqlite3`.

### Final Workspace Physical Lines

Recomputed after repair attempt 19 across every changed `src/` path relative to `HEAD`. These are raw physical source lines (including comments and blanks): executable tests are `*.test.ts` and `*.integration.test.ts`; authored support is local instructions plus test-support and fixture sources; remaining TypeScript is production.

| Surface | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Production | 10,548 | 12,019 | +1,471 |
| Executable tests | 39,739 | 38,457 | -1,282 |
| Authored support | 872 | 909 | +37 |

## Initiative

Lean behavioral verification: test only contracts a module declares and behavior it adds.
