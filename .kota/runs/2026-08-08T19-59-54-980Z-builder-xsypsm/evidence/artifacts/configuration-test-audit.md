# Configuration test audit

Scope: tests that inspect core configuration, shipped presets and model ids,
provider preset metadata, OpenRouter capability data, output-token limits, or
shipped pricing. The audit distinguishes copied declarative data from tests
where a value is an input marker for observable behavior.

## Removed or behavior-replaced

| Test surface | Decision | Rationale |
| --- | --- | --- |
| `src/core/config/config-warnings.test.ts` — direct `KNOWN_CONFIG_KEYS` inventory | Remove | It copied a runtime registry without exercising warning behavior. Known, unknown, and module-registered key behavior remains covered through `warnUnknownConfigKeys`. |
| `src/core/config/config.test.ts` — current vendor model names used as load/merge fixtures | Replace | The tests already covered loading, sanitization, and precedence. Synthetic model markers make that purpose explicit and cannot drift with the shipped registry. |
| `src/core/model/preset.test.ts` — shipped preset-id list, `PRESET_ENV_VAR`, Codex tier/model/token snapshot, and OpenRouter lab metadata snapshot | Remove | These assertions only froze declarations in `preset.ts`. Registry shape validation, uniqueness, lookup, unknown rejection, default membership, precedence, tier overrides, and auth resolution remain. |
| `src/core/model/preset.test.ts` — one literal auth test per preset | Replace | One registry-driven test now proves every declared alternative is reported when absent and any declared alternative satisfies auth. |
| `src/core/model/preset-readiness.test.ts` — copied Gemini model, tier, harness, and auth metadata | Replace | The readiness assertion now compares its projection with the selected canonical preset while retaining adapter readiness and missing-auth behavior. |
| `src/core/model/output-token-limits.test.ts` — exact shipped model ids and token counts | Replace | Provider-prefix and nested-provider alias behavior now select models and expected limits from the canonical shipped registry. Unknown-model rejection and explicit operator overrides remain synthetic. |
| `src/modules/model-clients/factory.test.ts` — `PROVIDER_PRESETS` provider inventory and direct defaults | Remove | The adjacent `createModelClientImpl` tests already prove provider parsing, base URL selection, API-key resolution, reasoning translator propagation, overrides, and rejection at the client boundary. |
| `src/modules/model-clients/generated/openrouter-catalog-data.ts` — duplicate OpenRouter lab tier map | Remove | `src/core/model/preset.ts` remains the sole shipped tier mapping. The capability catalog retains only provider-observed models and candidate-set data. |
| `src/modules/model-clients/openrouter-catalog.test.ts` — exact model capability snapshots, handpicked inclusions/exclusions, copied tier map, and route-decision lists | Remove or replace | Catalog shape, freshness, projection from the generated candidate source, local/unknown rejection, and resolution of every selected preset tier through the catalog remain. |
| `src/modules/model-clients/openrouter-capabilities.test.ts` — exact capability values for one shipped model | Replace | Mapping and factory propagation now compare outputs with the canonical selected catalog entry rather than another handwritten copy. |
| `src/modules/model-clients/pricing.test.ts` — manual priced-model list, exact rate tables, exact source URL list, and exact OpenRouter/Gemini rows | Replace | Coverage for every shipped preset model, explicit unpriced rationales, provider priced/unpriced behavior, provenance validation, and positive-rate validation remain. Pricing values stay in `pricing.ts`. |
| `src/shipped-model-pricing.integration.test.ts` — manual priced-model list | Replace | The CostTracker integration now exercises every row the canonical registry classifies as priced and still proves unknown models cost zero. |

## Retained behavioral coverage

| Test surface | Keep rationale |
| --- | --- |
| `src/core/config/config.test.ts`, config warning/trust/writer tests, and module config-slice tests | They exercise parsing, sanitization, layer precedence, merging, trust boundaries, filesystem safety, warning output, or registered-slice behavior. Literal strings are synthetic inputs and expected propagated outputs, not copies of shipped catalogs. |
| `src/core/model/preset.test.ts`, `preset-readiness*.test.ts`, `model-router.test.ts`, and `output-token-limits.test.ts` | They exercise lookup and rejection, precedence, overrides, routing, auth/readiness probes, registry invariants, alias resolution, operator overrides, or missing-limit failure. |
| `src/modules/model-clients/factory.test.ts`, request-body tests, and adapter/client tests | Provider/model strings select parser and wire-protocol branches. Assertions inspect constructed clients or request payloads, so they protect observable adapter behavior rather than the shipped preset mapping. |
| `src/modules/model-clients/openrouter-catalog.test.ts` candidate-set comparison | This is the permitted generated-projection case: resolver output is compared directly with the generated canonical candidate list, not a handwritten list. |
| `src/no-hardcoded-model-defaults.integration.test.ts`, `src/preset-parity-model-sweep.integration.test.ts`, `src/preset-parity.integration.test.ts`, and workflow validation/execution tests | They prevent fallback literals and prove the active preset reaches consumer surfaces, validated workflow steps, harnesses, CLI banners, or runtime calls. |
| Eval-harness baseline, attribution, storage, and provider-egress tests | Preset-shaped fixtures are inputs for fingerprint drift, persistence, attribution, and network-policy behavior. They do not assert that their model strings equal the shipped registry and therefore do not require edits when shipped mappings change. |
| `src/modules/model-clients/pricing.ts` and generated OpenRouter data | These are canonical registries inspected directly when individual data values need review; tests validate their consumers and structural invariants. |

## Source-search predicate

The completion transcript runs a focused search for the removed catalog-copy
patterns and current shipped model/tier literals across the rewritten tests.
Expected remaining vendor-model hits are limited to `factory.test.ts`, where
the strings select provider parsing and client-construction branches; no test
contains a copied shipped tier, token-limit, capability, or pricing catalog.
