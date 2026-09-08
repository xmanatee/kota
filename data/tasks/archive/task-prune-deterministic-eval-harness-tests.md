---
status: done
---

# Remove deterministic duplication from the eval harness

## Scope / Starting Points

Inventory every fixture, recording, copied repository, scorer, calibration case, replay format, compatibility reader, smoke gate, and test under `src/modules/eval-harness` plus eval cadence wiring.

## Required Changes

- For each asset record the model-dependent failure or realistic trajectory, historical regression if any, decision informed, cadence, cost, and deterministic-owner alternative.
- Retain agent capability for weak-model behavior, planning, research, tool use, and multi-step coding only when deterministic proof is insufficient.
- Move deterministic product, runtime, workflow, and protocol behavior to its production owner.
- Delete obsolete copied repositories, recordings, scorers, compatibility replay readers, and support code rather than archiving them indefinitely.
- Keep scorers outcome-oriented and independent of hidden reasoning or exact implementation paths.

## Must Not Complete While

Any eval asset is unclassified, any retained asset lacks a decision and model-dependent failure, deterministic checks have merely moved into fixture data, or an obsolete format remains supported without a current fixture.

## Done When

The asset inventory has zero unresolved rows; every retained eval names why deterministic proof is insufficient; all deleted assets and their final support consumers are removed; cadence membership and cost match the verification standard.

## Acceptance Evidence

Provide the asset/capability/decision/cadence/disposition matrix and before/after executable-eval, authored-fixture, scorer, and support LOC.

## Initiative

Lean behavioral verification: evals measure agent capability, not a second deterministic product specification.

## Completion evidence

Completed deterministic eval pruning. The fixture catalog is 32 → 17; all retained fixtures name a model-dependent failure, decision, provenance and deterministic alternative. The file-level inventory has 658 resolved rows and zero unresolved rows.

Removed prerecorded model answers, their adapter/recorder/CLI and private tool hooks, unused skill-ablation and ledger formats, shims, timestamp templates, obsolete copied fixture trees and reference samples. Scripted recall/memory trajectories defer to their existing production owner checks. Deterministic harness tests now run only in the owner portfolio; `test:eval` is an explicit live-model command. Weekly cadence requires provider egress and shares CLI preset/auth/cancellation resolution.

Scorers use behavioral oracles. Debugging observes routing; test writing uses mutation detection instead of exact test names. Removed 46 redundant JSON substring predicates. Builder fixtures explicitly name their task and resolve the production immutable dispatch after materialization, including later rounds. Removed no-op CLI/build stubs and supplied runtime task-integrity validation commands.

| Surface | Before LOC | After LOC |
| --- | ---: | ---: |
| executable-test | 16833 | 10339 |
| authored-fixture | 14740 | 7865 |
| scorer | 9775 | 6651 |
| support | 20256 | 16236 |

Counts are physical lines including comments/blanks, with disjoint categories defined in asset-matrix.md. Candidate fixture projects and calibration inputs are counted; no deleted source is hidden in an archive or new support file. Cadence/source-document wiring is separately inventoried.

Prior-build validation (before critic repair):
- Production and test TypeScript projects pass; this checks removed export consumers and precise runner contracts.
- Biome passes for the affected module, and scoped `git diff --check` is clean.
- Final owner run: 276 tests passed across 69 files (eval-harness, recall, memory lifecycle). This exercises scoring, rejection, subprocess policy, cadence, task binding, and the production owners replacing scripted trajectories.
- All 19 then-shipped fixtures passed initial-state and verifier-calibration probes. Golden, accepted-alternative, null, and adversarial cases use the production scorer with a controlled subprocess launcher. Builder dispatches resolve for each named task/round.
- Source CLI `kota eval list --json` returned the live catalog; transcript retained in eval-list.log.
- Task integrity validation passes; final transition uses the normal task command.

Limitations: no live provider trial, model comparison, or real OCI isolation qualification was run. Prose-grounding and dialogue clarification capabilities are unmeasured. Calibration and fake subprocess ports validate scoring/configuration, not model quality or container security. Time budgets in the matrix are workflow budgets, excluding calibration overhead; actual token/cost/resource telemetry is produced by live runs. Cadence still rejects non-comparable or unenforced evidence for gating.

Acceptance artifacts for builder run `2026-09-08T01-53-54-478Z-builder-cxvusx`:

- [Asset/capability/decision/cadence/disposition matrix](/Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-08t01-53-54-478z-builder-2b6be4592924d1d4b51c2380fc8c9452781ace0533ae6d3e9eb47d2835e3a4e9/agent/asset-matrix.md)
- [Complete per-file inventory](/Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-08t01-53-54-478z-builder-2b6be4592924d1d4b51c2380fc8c9452781ace0533ae6d3e9eb47d2835e3a4e9/agent/asset-inventory.csv)
- [Calibration and task-binding evidence](/Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-08t01-53-54-478z-builder-2b6be4592924d1d4b51c2380fc8c9452781ace0533ae6d3e9eb47d2835e3a4e9/agent/calibration-results.json)
- [Run summary and proof limitations](/Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-08t01-53-54-478z-builder-2b6be4592924d1d4b51c2380fc8c9452781ace0533ae6d3e9eb47d2835e3a4e9/agent/run-summary.md)


Repair of critic findings:
- Dialogue scoring now observes the primary and holdout outputs without reading candidate source text. The retained accepted-alternative calibration uses uppercase channel keys with normalized lookup and an example comment; both source-spelling regressions are represented in the normal calibration path.
- Retired the entire source-grounded research synthesis fixture, including its scorer, self-tests, copied packet, and calibration inputs. The critic demonstrated fabricated claims passing and correct paraphrases failing, so this fixture lacks an oracle for its claimed capability and fails the task's retention criteria. Quantitative scientific-claim reproduction remains; it does not substitute for prose grounding. Prose-grounding capability is explicitly unmeasured until a reliable semantic oracle is available.
- Regenerated the full asset matrix, per-file inventory, and LOC comparison: 653 resolved rows, zero unresolved rows, 18 retained fixtures.

Repair validation:
- Direct production dialogue scorer probes passed all eight groups: null, golden, uppercase accepted alternative, adversarial, equivalent source with example comment, hardcoded-primary rejection, ignored-time rejection, and negative self-tests. These exercise the exact executable checker on candidate trees and distinguish permissive scoring from source-spelling restrictions. See dialogue-repair-results.json and its reproducible dialogue-repair-probe.mjs.
- Inspected fixture discovery (only directories with fixture.json are loaded) and all module references: the retired research fixture has no surviving files or source consumers.
- Scoped diff whitespace validation passes. The target task remains archived as done; its contract and lifecycle state are unchanged by this repair.
- Full harness calibration and task validation were attempted but cannot start because this repair workspace lacks tsx/dependencies. Offline dependency installation was blocked by the sandbox (EPERM creating the configured package store). Earlier TypeScript/owner/calibration results below are prior-build evidence, not reruns of this repair. The direct JavaScript probes require no dependencies or model calls and are sufficient for the changed scorer; the inventory and reference inspection cover the removed asset.

[Repair scorer probe evidence](/Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-08t01-53-54-478z-builder-2b6be4592924d1d4b51c2380fc8c9452781ace0533ae6d3e9eb47d2835e3a4e9/agent/dialogue-repair-results.json)

Second critic repair:
- Removed candidate-source word/sample filters from protocol compliance, formal-spec faithfulness, algorithmic resource budgeting, and Spool strategy scoring. Removed their unused source readers/catalogs. Native module exports, observed case results, and opaque comparison counts own the respective contracts; the Spool interpreter rejects invalid instructions.
- Updated shortcut self-tests to check incorrect execution, rather than comments or required instruction catalogs. Resource metadata imports fail through actual module resolution; runtime loading errors are reported as issues instead of a source-audit verdict.
- A final scan found the same raw-word filter in black-box reconstruction. Removed it and its token assertion while retaining the copied-oracle byte check. Golden calibration candidates now contain the reported example/keyword comments, making false rejection visible in ordinary calibration.
- Ran 42 direct executable scorer checks across five fixtures: null and adversarial rejection, golden and existing accepted alternatives, equivalent comments/string literals/identifiers, and shortcut self-tests. A behaviorally correct embedded-oracle candidate still fails the copy guard with zero behavioral mismatches. All results match their expected verdicts. These dependency-free probes exercise the exact changed scoring commands; no model call or container-isolation claim is made. Evidence: scorer-repair-probe.mjs and scorer-repair-results.json in this run directory.
- Regenerated the 653-row acceptance inventory and LOC comparison; all rows remain resolved and 18 fixtures remain. Scoped diff whitespace validation passes. The archived target retains its existing done state.
- Retried pnpm validate-tasks: it cannot start because tsx is absent from this workspace. Full TypeScript/Vitest results remain prior-build evidence; this repair changes fixture JavaScript, calibration comments, one obsolete test assertion, and completion evidence only.


Third critic repair:
- Spool command provenance validates non-empty strings without prescribing command spelling. The existing accepted-alternative calibration now records the package scripts, so normal calibration catches the reported false rejection.
- All 14 direct scorer/command checks passed: initial and adversarial rejection, golden and accepted-alternative acceptance, equivalent package-script and relative-path commands, malformed command reports, inaccurate case counts, and shortcut rejection. Both `pnpm run examples` and `pnpm test` were executed successfully against the golden candidate. These checks exercise the exact production scorer without dependencies or model calls; they prove command-path independence while preserving behavioral and artifact validation. Reproducible evidence: spool-command-repair-probe.mjs and spool-command-repair-results.json in the run directory.
- Deleted all five obsolete task/scorer/case/validation/test files from .critic-scorer-8sqh5kjw; direct file enumeration and Git inspection confirm no surviving copied assets. The sandbox disallows removing its pre-existing empty directories; they contain no files and contribute no Git changes.
- Regenerated the acceptance inventory: 653 resolved rows, zero unresolved, 18 retained fixtures; scorer LOC is 6870. The target remains archived as done.
- JavaScript syntax and scoped diff whitespace checks pass. `pnpm validate-tasks` was retried and cannot start because `tsx` is missing; no task lifecycle or frontmatter changed in this repair. Full TypeScript/Vitest and task-validator success remain prior-build evidence.

Fourth critic repair:
- Protocol-compliance and formal-spec scorers now validate command provenance as non-empty strings and lists. Executed candidate cases and artifact consistency determine correctness; equivalent command spelling is accepted. Golden calibration reports use relative paths, and formal-spec's existing accepted alternative uses a package script.
- Removed scorer self-tests from all eight affected manifests' predicates and pre-run expectations, so calibration and live model verdicts no longer run them. Removed the same requirements from seeded candidate tasks and reported command lists. A focused owner suite invokes the eight scorer rejection scenarios independently; module instructions and the asset inventory record that cadence.
- All 77 direct executable checks passed: initial expectations, null/adversarial rejection, golden/alternative acceptance across eight fixtures, owner scorer self-tests, canonical/relative/package command invocation, malformed provenance rejection, and false case-count rejection. Canonical manifest inspection confirms no retained manifest references a scorer self-test. Reproducible evidence: command-and-cadence-repair-probe.mjs and command-and-cadence-repair-results.json in this run directory. These probes execute the production checkers without model calls and distinguish both reported failures.
- Regenerated the acceptance inventory: 654 resolved rows, zero unresolved, 18 retained fixtures. The target remains archived as done; task frontmatter and lifecycle are unchanged.
- JavaScript syntax and scoped diff whitespace checks pass. The owner test command and task validator were attempted but cannot start because Vitest and tsx are absent, respectively. Their earlier successes remain prior-build evidence. The direct probes validate scorer behavior; no live-model or OCI-isolation qualification is claimed.

Fifth critic repair:
- Retired the entire dialogue-driven coding fixture: simulator, scorer, candidate project, authored transcripts, calibration inputs, and its exclusive owner self-test entry. Candidate-written interaction records cannot establish tool use, and the keyword simulator both rejects useful paraphrases and cannot produce its accepted alternative. These are invalid measurement mechanisms under this task's retention criteria; no replacement clarification score is claimed.
- Corrected the watchlist coverage observation. Dialogue clarification remains unmeasured until runtime-owned interaction evidence and a calibrated semantic oracle are available. Prior dialogue calibration passes above are historical evidence and do not qualify this capability.
- Regenerated the asset matrix, per-file inventory, and LOC comparison: 654 resolved rows, zero unresolved, 17 retained fixtures. The target retains its archived done state.
- Dependency-free validation passed all seven remaining owner scorer self-tests using their actual executable commands. Inspected production discovery, confirmed the retired fixture contains no files, and found zero retired scorer/fixture references under src or docs. Scoped diff whitespace validation passes. See dialogue-retirement-probe.py and dialogue-retirement-results.json in the run directory. File deletion and consumer inspection prove removal without introducing a catalog-freezing test.
- Vitest and task validation were attempted and cannot start because vitest and tsx are missing. Existing TypeScript/Vitest/task-validator successes remain prior-build evidence. No live model or OCI isolation qualification is claimed. The sandbox leaves pre-existing empty fixture directories; they contain no files, are not discovered, and contribute no Git content.

Sixth critic repair:
- The evaluator-authoring scorer now runs each submitted evaluator against six controlled runner variations while preserving the case ids, paths, labels, and behavior hints. Repaired traces, missing lookup/refund calls, wrong order ids, email leaks, and combined violations require trace-sensitive verdicts and consistent metrics. The adversarial calibration now submits the reported constant-result fabrication instead of an unrelated decoy; the decoy is deleted. An owner regression suite distinguishes that shortcut from the executable golden evaluator.
- Both scientific artifact validators accept non-empty command provenance without prescribing spelling. Numerical results, filters, data identity, and row provenance remain checked; the production predicate still executes the analyzer on independent data. A focused owner regression covers truthful relative invocation, malformed commands, and wrong metrics.
- Dependency-free production probes passed: subprocess and imported-runner evaluators are accepted; constants, behavior-label classification, missing-lookup blindness, and wrong-order blindness are rejected. Both scientific validators accept correct results actually generated with canonical, relative, alternate-file, and package commands, including verifier data. Four malformed command values and three incorrect-result/provenance mutations are rejected for each command variant. See `scorer-boundary-repair-probe.mjs` and `scorer-boundary-repair-results.json` in the run directory. These distinguish the reported false acceptance and false rejection without claiming model capability results.
- Syntax checks pass for all seven changed JavaScript/TypeScript sources. The acceptance inventory is regenerated with 658 resolved rows, zero unresolved rows, and 17 retained fixtures. The task remains archived as done; lifecycle and frontmatter are unchanged.
- The focused owner test command and task validator were attempted but cannot start because Vitest and tsx are absent. No full TypeScript check, live model trial, or OCI-isolation qualification is claimed for this repair. Earlier full-suite successes above remain historical evidence.
