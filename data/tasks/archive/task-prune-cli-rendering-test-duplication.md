---
status: done
---
# Prune CLI and rendering duplication

## Scope / Starting Points

Inventory `src/modules/cli`, `src/modules/rendering`, command modules, source/built CLI suites, snapshots, result matrices, exit codes, confirmations, and local/daemon variants.

## Required Changes

- Centralize production rendering primitives and command-result mapping.
- Retain checks for option parsing, exit status, destructive confirmation, stable owner-visible wording, terminal behavior, and packaging failures.
- Delete copied domain result matrices, full-output snapshots for incidental formatting, source/built mirrors without packaging risk, and local/daemon mirrors made structural by transport.

## Must Not Complete While

Any command family is unclassified, any retained scenario lacks a CLI-specific failure, or duplicated domain lifecycle behavior remains.

## Done When

The inventory has zero unresolved rows and the retained CLI portfolio maps one-to-one to parsing, confirmation, rendering, exit-status, terminal, or packaging risks.

## Acceptance Evidence

Provide the command/scenario/disposition matrix and before/after executable-test and authored-support LOC.

## Initiative

Child of `task-prune-operator-and-channel-test-duplication`.

## Completion evidence

Task: task-prune-cli-rendering-test-duplication. All command families and candidate scenario rows are classified; unresolved rows: 0.

Command discovery used the production commands-mode ModuleLoader against the bundled modules. `commands.json` preserves the observed command tree. Entrypoint run/history, slash commands and rendering primitives are classified separately below. This is run evidence, not a maintained command registry.

## LOC evidence

| Surface | Before | After | Change |
| --- | ---: | ---: | ---: |
| Executable test files | 27294 | 25528 | -1766 |
| Authored support and data fixtures | 2873 | 2589 | -284 |

Physical newline LOC, including comments and inline fixtures, in the fixed 124-file candidate cohort; 121 executable test files remain. Test files and separately imported authored support/data fixtures are disjoint. Domain/protocol neighbors are included to make exclusions visible; these totals do not claim to count only test bodies. The before.json/after.json per-file records and scripts make the calculation inspectable. Generated assets, dist, dependencies and this run’s artifacts are excluded. Authored scenario declarations are not expanded executable test counts.

## Command families

| Family / commands | Production owner | Primary CLI risk | Disposition |
| --- | --- | --- | --- |
| acp | agent-client-protocol | packaging | Retain real stdio interoperability and stdout/stderr separation; wire and session cases stay in protocol. |
| agent list, agent inspect | agent-ops | rendering | Keep model, policy, source and setup wording plus narrow columns; remove per-theme mirrors. |
| knowledge list, knowledge search, knowledge show, knowledge add, knowledge delete, knowledge export, knowledge reindex, knowledge import, knowledge okf validate, knowledge okf import, knowledge okf export | knowledge | parsing | Keep input flags/stdin, export JSON/JSONL and wording. Delete import/store round-trips and theme copies; use production local client. |
| memory list, memory search, memory add, memory delete, memory reindex | memory | parsing | Keep content/tag/stdin forwarding and readable rows; replace shadow client with production client and remove theme copies. |
| task list, task show, task move, task create, task search, task reindex, task capture | repo-tasks | parsing | Keep state/search flags, empty/error/JSON/exit outcomes and narrow list. Remove storage-transition, capture-creation and column-declaration copies. |
| recall | recall | rendering | Keep filters, unavailable exit and shared source descriptions/score precision; delete full-output golden and source catalog assertion. |
| answer log, answer show, answer ask | answer | rendering | Keep citation/history/failure wording and filters; use the shared stderr transport. Synthesis and history lifecycle remain owner tests. |
| approval list, approval count, approval history, approval approve, approval approve-all, approval reject, approval reject-all | approval-queue | confirmation | Replace shadow queue/execution with typed response fixtures. Keep exact review before consent, digest/note forwarding, risk selection, sanitization, partial-failure exit and wording; one single/bulk outcome renderer. |
| daemon start, daemon status, daemon pid, daemon stop, daemon reload, daemon install, daemon uninstall, daemon qr | daemon-ops | packaging | Keep independent built bootstrap/restart/trust boundaries, installation effects, help wording and foreground terminal behavior. Runtime transitions stay in core. |
| events tail, events query | daemon-ops | terminal | Keep typed scope options and SSE/journal owners; stream writes use shared transport. No per-domain event-result matrix is admitted. |
| session list, session inspect, session set-mode | daemon-ops | parsing | Inspect list/inspect/set-mode parsing and typed client calls; mode transitions remain session owner tests. |
| status | daemon-ops | rendering | Keep offline/stale/scope/readiness/run evidence wording. Remove duplicate transcript-writing tests and retired flag catalog. |
| inbox | daemon-ops | rendering | Keep clear inbox and explicit attention/readiness wording; aggregation stays with inbox owner. |
| ui render, ui action execute, ui list | daemon-ops | confirmation | Keep shared surface rendering, typed parameters, disabled and confirmation gates; domain action lifecycle stays with its owner. |
| scope list, scope select, scope authority show, scope authority set, scope inspect, scope configure, scope add, scope status, scope retry, scope cancel, scope drain, scope remove | daemon-ops | parsing | Keep mutually exclusive selection, explicit authority/onboarding options, sanitization and confirmation. Delete literal verb catalog; retain real onboarding journey. |
| workflow list, workflow history, workflow stats, workflow export, workflow show, workflow step-inspect, workflow diff, workflow definitions, workflow deps, workflow explain, workflow definition-log, workflow cost, workflow logs, workflow follow, workflow trigger, workflow retry, workflow replay, workflow resume-run, workflow prune, workflow triggers, workflow dlq list, workflow dlq show, workflow dlq dismiss, workflow dlq redrive, workflow dlq export, workflow exec, workflow validate, workflow abort, workflow cancel, workflow pause, workflow resume, workflow reload, workflow disable, workflow enable, workflow status, workflow run abort, workflow trial, workflow simulate, workflow gc | workflow-ops | rendering | Keep authority diagnostics, controls, text/JSON/stream views and deliberate execution options. Remove theme copies; runtime admission/recovery remains owner proof. |
| owner-question list, owner-question show, owner-question answer, owner-question dismiss, owner-question count, owner-question history | owner-questions | parsing | Replace simulated question lifecycle with typed client responses; keep full context, answer behavior, optional reason, history filter, missing-target exit and count output. |
| inbound-signals routes | inbound-signals | rendering | Inspect routes/validation output through its generated namespace; routing decisions remain inbound-signals owner tests. |
| doctor | doctor | exit-status | Inspect report/fix command mapping; keep readiness, credential redaction and diagnosis at doctor owner. No client lifecycle matrix. |
| agy-canary | autonomy | parsing | Keep elapsed-window/incident reviewer behavior at canary owner; inspect CLI option forwarding and report output. |
| digest | autonomy | rendering | Keep text/JSON selection and active/quiet meaning; remove mirrored non-emission/cadence checks and full-output sample fixtures. |
| attention | autonomy | rendering | Keep text/JSON and empty wording; remove duplicate non-emission check owned by on-demand detector. |
| report sources | autonomy | rendering | Keep report flags, human sections, JSON, redaction and unavailable evidence wording; aggregations stay with report owner. |
| architecture status, architecture scan, architecture review | architecture-gardener | rendering | Inspect status/scan/review mapping; metrics and review semantics stay at architecture owner. |
| browser source-access-report | browser | packaging | Keep CLI runtime hydration before source-access tools; browser interaction and article extraction remain browser owner checks. |
| capture | capture | parsing | Inspect target/text/JSON mapping through generated client; remove private stderr transport. Classification and persistence stay with capture/store owners. |
| module list, module inspect, module new, module reload | module-manager | rendering | Keep module inventory readability and narrow columns; remove theme copies. Scaffolding and reload remain module owners. |
| navigate | cli | terminal | Keep keyboard focus, redraw/resize, palette, live events, confirmation, target selection and secret-input refusal; typed UI responses avoid lifecycle simulation. |
| completion | completion | parsing | Keep generated zsh/bash scripts, nested flags and shell selection/rejection; these are shell-specific projections, not copied module catalogs. |
| config validate, config get, config set, config schema | config | parsing | Keep CLI values/JSON and warnings; resolver/setter/schema behavior stays with config owner and generator freshness, without a per-transport matrix. |
| eval list, eval run, eval record-agent-step, eval calibration, eval fixture-candidates, eval agy-models | eval-harness | parsing | Keep deliberate isolation/provider/candidate flags, reporting and gated exit code; execution/classification stays in eval cadence. |
| audit list | guardrails-audit | rendering | Keep risk/policy/limit forwarding, empty output and manifest/session context; no audit lifecycle copy. |
| harness-parity list, harness-parity run, harness-parity matrix | harness-parity | parsing | Inspect list/run/matrix forwarding; runner/model matrix decisions stay with owner. Authored transport timeout/semantic errors are exceptions, not local/daemon mirrors. |
| mcp-registry import, mcp-registry tunnel inspect | mcp-registry | rendering | Keep import JSON output and credential-safe tunnel inspection; remote registry/network behavior remains owner. |
| mcp-server | mcp-server | packaging | Keep built stdio bootstrap and HTTP option/endpoint output; delete module metadata, registration and default-value catalogs. |
| owner-decision list, owner-decision show, owner-decision answer, owner-decision cancel | owner-decisions | parsing | Inspect exclusive answer flags, JSON form, list/status and missing/settled exit mapping; share age rendering. Decision revision/expiry/resume remain core owner. |
| tools install, tools list, tools remove, tools update | registry | packaging | Inspect command registration from live commands-mode loader; remove duplicate source tools-list/help invocations. Installation lifecycle stays registry owner. |
| skill list, skill import | skill-ops | rendering | Keep readable skill projection once; remove per-theme copies. Import semantics stay skill owner. |
| resource-discovery | resource-discovery | rendering | Keep JSON envelope and stale-route diagnostic/fallback exception; routine transport is generated. |
| retract | retract | parsing | Inspect required target/identifier, JSON and failure exit; remove private stderr transport. Store removal and destructive-tool policy remain owners. |
| secrets set, secrets get, secrets list, secrets remove | secrets | terminal | Keep raw-TTY non-echo and piped-input behavior; store/credential injection remains secrets owner. No CLI store-result matrix. |
| setup list, setup submit, setup secret, setup start, setup complete, setup refresh, setup revoke | setup | terminal | Keep stdin secret handling, redaction, explicit options and credential metadata; setup lifecycle and route scope stay owner. |
| voice transcribe, voice speak | voice | rendering | Keep transcription text, output-file flag, daemon-required hints and failure exit; audio transform is an authored transport exception. |
| serve | web | packaging | Retain its independent packaged runtime hydration/HTTP bootstrap; source help mirrors removed. |
| webhook list, webhook secret generate, webhook secret remove | webhook | rendering | Keep configured/empty wording, secret exposure rule, overwrite warning, signing guidance and removal confirmation; remove duplicate secret generation/config lifecycle checks. |
| run | entrypoint | parsing | Keep numeric/preset/auth errors, TTY routing, REPL boot and resume scope/confirmation journeys; remove help/option catalogs. |
| history | history | confirmation | Keep destructive clear consent and --yes, search/show options, JSON and resume scope. Remove repeated table theme and private column declaration checks. |
| slash commands | commands | owner | Classified outside terminal CLI: derived skill/workflow catalog and HTTP capability/dispatch transforms remain with commands owner; no copied terminal catalog added. |
| rendering primitives | rendering | rendering | Retain theme/ANSI/width/layout/animation at one rendering owner; remove transport cache-identity assertion. Shared age and stderr primitives replace local copies. |

## Scenario and owner evidence

The inline scenario matrix below records every candidate before-scenario and every newly authored scenario (also retained as `scenario-dispositions.tsv` in the run directory), including the disposition, single primary risk, owner and actual Vitest cadence. A row classified as owner behavior or protocol is explicitly outside the retained CLI portfolio. The CLI cases each protect parsing, confirmation, rendering, exit status, terminal behavior or packaged bootstrap; semantic result arms are represented only where their terminal presentation differs.

Deleted module→CLI lifecycle/catalog tests are covered by core ModuleLoader registration/group/unload/commands-mode tests and independent packaged bootstrap checks. Approval authorization, replay, expiry and execution remain under core daemon and approval execution owners. Owner-question/decision lifecycle stays in the core queues/stores. Task transition/path/persistence, knowledge import/store parsing, webhook secret mutation and digest cadence/non-emission remain at their production owners. Generated routine transports and aggregate namespace types remove the need for CLI local/daemon result mirrors; authored auth/redaction/SSE/binary/404 transforms remain separate protocol responsibilities.

Full-output daily-digest snapshots and their unused fixture data were removed; active and quiet semantic wording remains. Recall keeps the shared semantic description/score fixture consumed by clients, without the incidental full-table snapshot or copied source catalog. Per-surface theme loops were reduced to one semantic render and the relevant narrow-width case; themes are exercised centrally by rendering tests. Duplicate transcript-writing tests were removed, including their arbitrary-run-directory discovery.

## Repair validation and scope

Both `history/cli.ts` and `history/cli-commands.ts` now import `getStderrTransport` from the rendering owner. Their private lazy transports are removed. Inspection of the patch verifies that all existing RenderNodes, messages, option decisions and exit codes remain unchanged; only transport selection changes. Rendering's custom stream instances remain in its own provider/agent-stream implementations, where they own separate terminal sessions.

The original build's `validation.md` records passing production/test TypeScript checks, lint, changed command/renderer suites, the 27-case source CLI portfolio, and packaged MCP stdio smoke. Those are prior-run results, not reruns during this repair. Packaged daemon/serve socket tests hit `listen EPERM 127.0.0.1`; their bootstrap behavior remains unverified here.

During this repair, current-source task validation passed through Node's native TypeScript stripping and a run-local import resolver (zero errors/warnings). Both changed history files passed Node TypeScript syntax checking; `git diff --check` passed. A current-source rendering probe checked shared stdout/stderr separation, the history usage and positive-integer diagnostics, newline framing, and absence of ANSI in pipes. The history call-site diff supplies the connection to that shared transport; the probe does not claim to execute a full history command. No new executable test duplicates the existing command and transport cases.

Repair-time Vitest/typecheck reruns were unavailable because this session has no installed `tsx`, Vitest or Commander. Both source and built normal task commands failed at missing package imports; dependency installation was denied at the configured package store and read-only `node_modules`. The earlier run also recorded unavailable workflow dispatcher authority in the standalone CLI. The supplied writer workspace is the only task mutation target; task-domain operations perform the body update and archive transition without changing canonical state or Git metadata.

## Second critic repair

Removed eval CLI candidate classification, report-file persistence and accepted-task creation assertions; their production-owner suites remain `fixture-candidates.test.ts` and `fixture-candidates-proposals.test.ts`. One authored boundary response now isolates repeatable run-id collection, scan filters, numeric limit conversion, output directory and create-task forwarding, plus summary counts and returned artifact paths. Distinct count values detect swapped presentation fields. It does not simulate candidate lifecycle. Removed the config file-existence-only scenario: the preceding setter invocation already reads the newly created file and verifies its value.

Both edited test files pass Node native TypeScript syntax checking. Static comparison against the production command verifies the options and response fields; inspection of the unchanged domain suites verifies that classification, persisted report content and accepted-task content retain their owning checks. Focused eval/config Vitest and test typechecking could not start because Vitest and tsc are absent. These are unavailable validations, not passes. No production behavior changed in this repair.

## Reproducible LOC scope

Baseline: Git HEAD `1e8fbe3d6b75c83f3170045987cb9917dd0ed05f`. Repair checked every before-file count with `git show HEAD:<path>` and every after-file count against the current workspace; zero discrepancies. Count is physical newline LOC, including comments and inline fixtures. Test-body-only LOC and parameter-expanded test counts are not claimed. Every row below is part of the fixed candidate cohort; a deleted file contributes zero after.

| Executable test file | Before | After |
| --- | ---: | ---: |
| src/built-cli-daemon-authority.integration.test.ts | 220 | 220 |
| src/built-cli-daemon.integration.test.ts | 249 | 249 |
| src/built-cli-mcp-server.integration.test.ts | 261 | 261 |
| src/built-cli-serve.integration.test.ts | 255 | 255 |
| src/cli.test.ts | 591 | 532 |
| src/distributable-surfaces.test.ts | 49 | 49 |
| src/module-cli-commands.integration.test.ts | 65 | 0 |
| src/module-cli.integration.test.ts | 226 | 0 |
| src/modules/agent-client-protocol/index.test.ts | 1440 | 1440 |
| src/modules/agent-ops/agent-list-node.test.ts | 135 | 130 |
| src/modules/answer/cli.test.ts | 376 | 376 |
| src/modules/approval-queue/cli-bulk.test.ts | 129 | 53 |
| src/modules/approval-queue/cli-history.test.ts | 119 | 45 |
| src/modules/approval-queue/cli-list.test.ts | 120 | 45 |
| src/modules/approval-queue/cli.test.ts | 159 | 76 |
| src/modules/approval-queue/daemon-client-mutations.test.ts | 144 | 144 |
| src/modules/approval-queue/local-client-execution.test.ts | 115 | 115 |
| src/modules/approval-queue/routes.test.ts | 269 | 269 |
| src/modules/architecture-gardener/status.test.ts | 71 | 71 |
| src/modules/autonomy/agy-continuous-canary-cli.test.ts | 529 | 529 |
| src/modules/autonomy/report/render-control-coverage.test.ts | 105 | 105 |
| src/modules/autonomy/report/render-owner-interventions.test.ts | 105 | 105 |
| src/modules/autonomy/report/render-populated.test.ts | 226 | 226 |
| src/modules/autonomy/report/render-review-scrutiny.test.ts | 77 | 77 |
| src/modules/autonomy/report/render.test.ts | 159 | 159 |
| src/modules/autonomy/report/report-cli-process-discipline.test.ts | 69 | 69 |
| src/modules/autonomy/report/report-cli-supervision-load.test.ts | 273 | 273 |
| src/modules/autonomy/report/report-cli.test.ts | 279 | 279 |
| src/modules/autonomy/report/report-shadow-semantic-reviews.test.ts | 214 | 214 |
| src/modules/autonomy/report/source-decision-coverage.test.ts | 280 | 280 |
| src/modules/autonomy/workflows/attention-digest/attention-cli.test.ts | 163 | 141 |
| src/modules/autonomy/workflows/attention-digest/step.test.ts | 674 | 674 |
| src/modules/autonomy/workflows/daily-digest/digest-cli.test.ts | 142 | 117 |
| src/modules/autonomy/workflows/daily-digest/on-demand.test.ts | 153 | 153 |
| src/modules/autonomy/workflows/daily-digest/render.test.ts | 155 | 118 |
| src/modules/browser/browser-interaction-tools.test.ts | 119 | 119 |
| src/modules/browser/cli.test.ts | 134 | 134 |
| src/modules/browser/rendered-article-read.test.ts | 131 | 131 |
| src/modules/cli/navigator-actions.test.ts | 107 | 107 |
| src/modules/cli/navigator-operator-console.test.ts | 135 | 135 |
| src/modules/cli/navigator-terminal-prompt.test.ts | 78 | 78 |
| src/modules/cli/navigator.test.ts | 244 | 244 |
| src/modules/commands/catalog.test.ts | 172 | 172 |
| src/modules/commands/daemon-control.test.ts | 444 | 444 |
| src/modules/completion/completion.test.ts | 110 | 110 |
| src/modules/config/config.test.ts | 437 | 429 |
| src/modules/daemon-ops/daemon-help.test.ts | 69 | 69 |
| src/modules/daemon-ops/daemon-service-commands.test.ts | 168 | 168 |
| src/modules/daemon-ops/dashboard-control-affordances.test.ts | 85 | 85 |
| src/modules/daemon-ops/dashboard-render-activity.test.ts | 118 | 118 |
| src/modules/daemon-ops/dashboard-render-status.test.ts | 150 | 150 |
| src/modules/daemon-ops/dashboard-render-transcript.test.ts | 67 | 0 |
| src/modules/daemon-ops/dashboard.test.ts | 220 | 220 |
| src/modules/daemon-ops/format-utils.test.ts | 76 | 76 |
| src/modules/daemon-ops/index.test.ts | 183 | 183 |
| src/modules/daemon-ops/local-ui-client.test.ts | 239 | 239 |
| src/modules/daemon-ops/operator-inbox.test.ts | 247 | 247 |
| src/modules/daemon-ops/operator-ui-continuity.test.ts | 217 | 217 |
| src/modules/daemon-ops/operator-ui.test.ts | 617 | 617 |
| src/modules/daemon-ops/scopes-authority-daemon-client.test.ts | 172 | 172 |
| src/modules/daemon-ops/scopes-cli.test.ts | 646 | 625 |
| src/modules/daemon-ops/scopes-local.test.ts | 128 | 128 |
| src/modules/daemon-ops/status-cli-gather.test.ts | 202 | 202 |
| src/modules/daemon-ops/status-cli-worktrees.test.ts | 222 | 191 |
| src/modules/daemon-ops/status-cli.test.ts | 591 | 406 |
| src/modules/eval-harness/agy-model-evaluation-runner.test.ts | 199 | 199 |
| src/modules/eval-harness/agy-model-evaluation-scenarios.test.ts | 255 | 255 |
| src/modules/eval-harness/cli-agy-models.test.ts | 100 | 100 |
| src/modules/eval-harness/cli-calibration.test.ts | 122 | 122 |
| src/modules/eval-harness/cli-fixture-candidates.test.ts | 160 | 80 |
| src/modules/eval-harness/cli-list.test.ts | 117 | 117 |
| src/modules/eval-harness/cli-run-options.test.ts | 191 | 191 |
| src/modules/eval-harness/cli-run-reporting.test.ts | 155 | 155 |
| src/modules/eval-harness/daemon-client-agy.test.ts | 50 | 50 |
| src/modules/guardrails-audit/cli.test.ts | 181 | 181 |
| src/modules/history/cli.test.ts | 707 | 707 |
| src/modules/history/history-list-node.test.ts | 63 | 52 |
| src/modules/knowledge/cli-okf-command.test.ts | 129 | 129 |
| src/modules/knowledge/cli.test.ts | 441 | 326 |
| src/modules/knowledge/knowledge-list-node.test.ts | 64 | 59 |
| src/modules/mcp-registry/index.test.ts | 157 | 157 |
| src/modules/mcp-server/index.test.ts | 137 | 113 |
| src/modules/mcp-server/interoperability.test.ts | 145 | 145 |
| src/modules/memory/cli.test.ts | 234 | 163 |
| src/modules/memory/memory-list-node.test.ts | 43 | 38 |
| src/modules/module-manager/module-list-node.test.ts | 63 | 58 |
| src/modules/owner-decisions/daemon-client.test.ts | 59 | 59 |
| src/modules/owner-questions/cli.test.ts | 287 | 106 |
| src/modules/recall/cli.test.ts | 181 | 181 |
| src/modules/recall/render.test.ts | 62 | 46 |
| src/modules/rendering/cli-transport.test.ts | 83 | 83 |
| src/modules/rendering/render.test.ts | 357 | 357 |
| src/modules/rendering/safe-terminal-text.test.ts | 26 | 26 |
| src/modules/rendering/transport.test.ts | 218 | 208 |
| src/modules/repo-tasks/cli-move-security.test.ts | 73 | 73 |
| src/modules/repo-tasks/cli.test.ts | 637 | 553 |
| src/modules/repo-tasks/daemon-client-move-security.test.ts | 37 | 37 |
| src/modules/resource-discovery/cli.test.ts | 152 | 152 |
| src/modules/secrets/prompt.test.ts | 59 | 59 |
| src/modules/setup/index.test.ts | 572 | 572 |
| src/modules/setup/scope-client.test.ts | 199 | 199 |
| src/modules/setup/ui-surface.test.ts | 305 | 305 |
| src/modules/skill-ops/skill-list-node.test.ts | 49 | 45 |
| src/modules/voice/cli.test.ts | 167 | 167 |
| src/modules/webhook/cli.test.ts | 281 | 204 |
| src/modules/workflow-ops/dead-letter-local-client.test.ts | 100 | 100 |
| src/modules/workflow-ops/definitions/definition-log.test.ts | 81 | 81 |
| src/modules/workflow-ops/definitions/explain.test.ts | 210 | 210 |
| src/modules/workflow-ops/execution/dry-run.test.ts | 820 | 820 |
| src/modules/workflow-ops/execution/exec.test.ts | 275 | 275 |
| src/modules/workflow-ops/execution/trial.test.ts | 1214 | 1214 |
| src/modules/workflow-ops/execution/trigger-authority.test.ts | 70 | 70 |
| src/modules/workflow-ops/index.test.ts | 13 | 13 |
| src/modules/workflow-ops/runs/authority-errors.test.ts | 87 | 87 |
| src/modules/workflow-ops/runs/follow.test.ts | 215 | 215 |
| src/modules/workflow-ops/runs/run-cost-node.test.ts | 120 | 115 |
| src/modules/workflow-ops/runs/run-diff.test.ts | 180 | 180 |
| src/modules/workflow-ops/runs/run-list-node.test.ts | 125 | 121 |
| src/modules/workflow-ops/runs/run-show.test.ts | 227 | 222 |
| src/modules/workflow-ops/runs/run-stats-node.test.ts | 53 | 48 |
| src/modules/workflow-ops/runs/step-inspect.test.ts | 193 | 193 |
| src/modules/workflow-ops/simulation/cli.test.ts | 210 | 210 |
| src/modules/workflow-ops/ui-surface.test.ts | 247 | 247 |
| src/scope-onboarding-cli.integration.test.ts | 213 | 213 |

Authored support and data fixtures are disjoint from executable files; generated assets, dependencies, `dist` and acceptance evidence are excluded. Inline fixtures are counted once with their executable file.

| Authored support / fixture | Before | After |
| --- | ---: | ---: |
| clients/conformance/recall-render-fixture.json | 91 | 91 |
| src/core/daemon/built-cli-daemon-test-support.integration.ts | 146 | 146 |
| src/core/server/daemon-client-test-support.ts | 98 | 98 |
| src/core/workflow/testing/writer-integration-fixture.ts | 54 | 54 |
| src/modules/approval-queue/cli-test-support.integration.ts | 200 | 51 |
| src/modules/approval-queue/daemon-client-test-support.integration.ts | 84 | 84 |
| src/modules/autonomy/report/render-test-helpers.ts | 17 | 17 |
| src/modules/autonomy/report/report-test-fixtures.ts | 207 | 207 |
| src/modules/autonomy/workflows/daily-digest/__fixtures__/sample-active.json | 75 | 0 |
| src/modules/autonomy/workflows/daily-digest/__fixtures__/sample-active.txt | 30 | 0 |
| src/modules/autonomy/workflows/daily-digest/__fixtures__/sample-quiet.json | 17 | 0 |
| src/modules/autonomy/workflows/daily-digest/__fixtures__/sample-quiet.txt | 8 | 0 |
| src/modules/cli/navigator-operator-console-fixture-actions.test-support.ts | 154 | 154 |
| src/modules/cli/navigator-operator-console-fixture.test-support.ts | 106 | 106 |
| src/modules/cli/navigator-operator-console-run-fixture.test-support.ts | 136 | 136 |
| src/modules/cli/navigator-test-client.ts | 12 | 12 |
| src/modules/cli/navigator-test-surfaces.test-support.ts | 114 | 114 |
| src/modules/daemon-ops/dashboard-test-support.ts | 47 | 47 |
| src/modules/daemon-ops/operator-ui-continuity-test-helpers.ts | 104 | 104 |
| src/modules/daemon-ops/scopes-daemon-client-test-support.ts | 41 | 41 |
| src/modules/eval-harness/agy-model-evaluation-test-support.ts | 138 | 138 |
| src/modules/eval-harness/cli-test-support.ts | 205 | 205 |
| src/modules/eval-harness/daemon-client-test-support.ts | 175 | 175 |
| src/modules/eval-harness/fixture-run.ts | 271 | 271 |
| src/modules/eval-harness/fixture.ts | 8 | 8 |
| src/modules/eval-harness/subprocess-executor-test-helpers.ts | 190 | 190 |
| src/modules/webhook/cli-test-support.ts | 145 | 140 |

## Complete scenario disposition matrix

837 rows classify 810 before-scenario declarations plus 27 rewritten declarations. The final cohort has 752 declarations: 538 CLI/terminal/packaging declarations and 214 explicitly separate domain or protocol declarations. Parameterized declarations are not expanded. Unresolved rows: 0.

Consumer is the terminal operator for retained CLI rows, protocol peer for protocol rows, and the named subsystem for domain rows. Each section identifies the production owner and actual execution cadence; `owner` is a Vitest partition, not a claim that every test in it checks domain lifecycle. Public stimulus and observable assertion are identified by the authored scenario description and its linked owning suite. The risk column names the distinct CLI failure category: parsing loses/reinterprets input, confirmation applies an effect without the requested consent, rendering loses/misstates operator information, exit-status misreports success to scripts, terminal corrupts streams/input/redraw, and packaging fails to load or bootstrap the distributed product. Domain/protocol neighbors are retained outside the CLI portfolio; their inclusion in the LOC cohort is explicit rather than being presented as CLI coverage.

Theme-loop names normalized from `${name}` to `no-color` mean the semantic case is retained once, with the theme variants removed. A replaced/pruned row points to the current scenarios in the same suite and the family disposition above. A deleted suite's replacement owner is explained in the command-family and scenario-owner sections above.

### src/built-cli-daemon-authority.integration.test.ts

Production owner: packaging / module loader. Cadence: integration. Retained suite: [src/built-cli-daemon-authority.integration.test.ts](../../../src/built-cli-daemon-authority.integration.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "quarantines and restarts away installed modules when live trust is revoked" | retain | packaging |

### src/built-cli-daemon.integration.test.ts

Production owner: packaging / module loader. Cadence: integration. Retained suite: [src/built-cli-daemon.integration.test.ts](../../../src/built-cli-daemon.integration.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "`node dist/cli.js daemon` serves /api/knowledge with 200 (provider onLoad ran)" | retain | packaging |
| "relaunches the supervised child after a runtime restart request" | retain | packaging |

### src/built-cli-mcp-server.integration.test.ts

Production owner: packaging / module loader. Cadence: integration. Retained suite: [src/built-cli-mcp-server.integration.test.ts](../../../src/built-cli-mcp-server.integration.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "`node dist/cli.js mcp-server` advertises a non-empty tool list (registerTool ran in onLoad)" | retain | packaging |

### src/built-cli-serve.integration.test.ts

Production owner: packaging / module loader. Cadence: integration. Retained suite: [src/built-cli-serve.integration.test.ts](../../../src/built-cli-serve.integration.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "`node dist/cli.js serve` serves /api/knowledge with 200 (provider onLoad ran)" | retain | packaging |

### src/cli.test.ts

Production owner: entrypoint / history / REPL. Cadence: cli. Retained suite: [src/cli.test.ts](../../../src/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "--help shows KOTA description" | retain | parsing |
| "--version prints semver" | retain | parsing |
| "run --help lists all run-specific options" | replace/prune; see current owner scenarios | parsing |
| "default model is the active preset's defaultModel" | replace/prune; see current owner scenarios | rendering |
| "routes bare TTY invocation to the operator console while preserving explicit run" | retain | terminal |
| "exits with clear message when ANTHROPIC_API_KEY is unset (claude preset preflight)" | retain | exit-status |
| "does not require API key for help commands" | replace/prune; see current owner scenarios | rendering |
| "does not require API key for tools list" | replace/prune; see current owner scenarios | rendering |
| "detects 'Could not resolve authentication' error" | retain | rendering |
| "detects apiKey-related error" | retain | rendering |
| "detects 401 status error" | retain | rendering |
| "returns null for non-auth errors" | retain | rendering |
| "parses valid positive integers" | retain | parsing |
| "rejects non-numeric strings" | retain | rendering |
| "rejects zero" | retain | rendering |
| "rejects negative numbers" | retain | rendering |
| "rejects floating point for serve port" | retain | rendering |
| "rejects invalid think-budget" | retain | parsing |
| "rejects invalid history limit" | retain | parsing |
| "rejects an unknown --preset id" | retain | parsing |
| "rejects an unknown KOTA_PRESET env value" | retain | rendering |
| "starts interactive harness mode without relying on runtime rendering providers" | retain | rendering |
| "exits with error when no previous conversation exists" | retain | exit-status |
| "serve --help lists port and model options" | replace/prune; see current owner scenarios | parsing |
| "tools --help lists install, list, remove, update" | replace/prune; see current owner scenarios | parsing |
| "history --help lists list, show, resume, delete, clear" | replace/prune; see current owner scenarios | parsing |
| "cancels when stdin is not a TTY (no --yes)" | retain | confirmation |
| "deletes when --yes flag is provided" | retain | confirmation |
| "reports no conversations when history is empty" | retain | rendering |
| "exits with error for non-existent conversation ID" | retain | exit-status |
| "resumes an explicit id in the saved scope directory" | retain | rendering |
| "run --continue with an explicit id binds the classic session to the saved scope directory" | retain | parsing |
| "fails explicit resume when the saved cwd is missing" | retain | rendering |
| "allows explicit resume cwd override when the saved cwd is missing" | retain | rendering |

### src/distributable-surfaces.test.ts

Production owner: packaging / module loader. Cadence: owner. Retained suite: [src/distributable-surfaces.test.ts](../../../src/distributable-surfaces.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "package.json bin target exists and imports a resolvable module" | retain | packaging |
| "uses the source entry point for workspace commands" | retain | packaging |
| "references expected env vars and webhook path shape" | retain | packaging |

### src/module-cli-commands.integration.test.ts

Production owner: packaging / module loader. Cadence: cli. Deleted suite; before evidence is available at the baseline Git revision.

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "--help lists all module-provided commands" | delete; owning mechanism/focused scenario retained (owner mapping above) | parsing |
| "module commands have working --help" | delete; owning mechanism/focused scenario retained (owner mapping above) | parsing |
| "tools subcommand from registry module works" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |

### src/module-cli.integration.test.ts

Production owner: packaging / module loader. Cadence: integration. Deleted suite; before evidence is available at the baseline Git revision.

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "ModuleLoader.loadAll registers tools from all tool-providing modules" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "ModuleLoader.loadAll registers all bundled modules" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "\"commands\" mode loader produces same commands as runtime loader (no tool side-effects)" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "module tools appear in tool registry when groups are enabled" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "unloadAll clears module tools and resets state" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "getRoutes collects HTTP routes from route-providing modules" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "can load, unload, and reload modules cleanly" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |
| "two loaders cannot register the same module tools simultaneously" | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |

### src/modules/agent-client-protocol/index.test.ts

Production owner: agent-client-protocol. Cadence: protocol. Retained suite: [src/modules/agent-client-protocol/index.test.ts](../../../src/modules/agent-client-protocol/index.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "responds to initialize with honest KOTA ACP capabilities" | retain | protocol |
| "does not initialize a mismatched protocol version" | retain | protocol |
| "creates a daemon-backed ACP session for the selected scope root" | retain | protocol |
| "rejects stdio MCP handoff on session/new without daemon side effects or secret leakage" | retain | protocol |
| "creates an ACP session for a configured non-active scope root" | retain | protocol |
| "lists daemon-owned ACP sessions for the requested scope root" | retain | protocol |
| "resumes a persisted daemon session and prompts through the resumed binding" | retain | protocol |
| "rejects stdio MCP handoff on session/resume before daemon side effects" | retain | protocol |
| "attaches to a live daemon session after an ACP adapter restart" | retain | protocol |
| "rejects resume for an already-active ACP connection session" | retain | protocol |
| "rejects resume for unknown sessions" | retain | protocol |
| "streams ACP session/update notifications before the prompt response" | retain | protocol |
| "correlates outgoing permission request ids and ignores unrelated peer responses" | retain | protocol |
| "round-trips allow and deny permission responses through ACP-owned prompts" | retain | protocol |
| "redacts secret-shaped permission request input fields" | retain | protocol |
| "rejects malformed permission responses and clears the active prompt" | retain | protocol |
| "correlates structurally malformed permission responses and clears the active prompt" | retain | protocol |
| "rejects empty permission response frames and clears the active prompt" | retain | protocol |
| "cancels an active prompt and returns the cancelled stop reason" | retain | protocol |
| "cancels a prompt while waiting for a permission response" | retain | protocol |
| "disconnect cleanup cancels prompts waiting for permission" | retain | protocol |
| "times out permission responses and clears pending prompt state" | retain | protocol |
| "reports malformed JSON-RPC as a parse error" | retain | protocol |
| "rejects unsupported ACP methods without daemon side effects" | retain | protocol |
| "rejects malformed MCP handoff without creating a session or leaking secrets" | retain | protocol |
| "rejects non-empty MCP handoff and unsupported transports before daemon side effects" | retain | protocol |
| "parses daemon SSE chat into ACP streamed updates" | retain | protocol |
| "answers daemon approval SSE requests with ACP permission decisions" | retain | protocol |
| "creates HTTP daemon sessions with the selected scope id" | retain | protocol |
| "lists HTTP daemon live sessions and persisted bindings for ACP discovery" | retain | protocol |
| "wakes HTTP daemon sessions by prior session id" | retain | protocol |
| "cancels HTTP daemon turns without deleting the session" | retain | protocol |
| "keeps stdout as JSON-RPC only and writes diagnostics to stderr" | retain | terminal |
| "aborts pending permission prompts when the ACP stdio client disconnects" | retain | protocol |

### src/modules/agent-ops/agent-list-node.test.ts

Production owner: agent-ops. Cadence: owner. Retained suite: [src/modules/agent-ops/agent-list-node.test.ts](../../../src/modules/agent-ops/agent-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders the agents table in ${name} theme` | retain | rendering |
| "compresses cleanly under a narrow terminal width" | retain | rendering |
| "builds inspect entries for source paths, policy, module links, and setup readiness" | retain | rendering |

### src/modules/answer/cli.test.ts

Production owner: answer. Cadence: owner. Retained suite: [src/modules/answer/cli.test.ts](../../../src/modules/answer/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders the synthesized answer and a typed citation list" | retain | rendering |
| "forwards --limit, --source, and --min-score into the answer filter" | retain | parsing |
| "exits non-zero with a no_hits message" | retain | exit-status |
| "renders an empty-store hint" | retain | rendering |
| "renders mixed ok and ok=false rows" | retain | rendering |
| "forwards --limit and --before through to the client" | retain | parsing |
| "re-renders an ok:true record body and citations" | retain | rendering |
| "renders the failure reason for an ok:false record without a synthesized body" | retain | rendering |
| "exits non-zero when the record id is not found" | retain | exit-status |

### src/modules/approval-queue/cli-bulk.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/cli-bulk.test.ts](../../../src/modules/approval-queue/cli-bulk.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints empty messages when no approvals are pending" | replace/prune; see current owner scenarios | rendering |
| "approves every pending item" | replace/prune; see current owner scenarios | rendering |
| "uses daemon execution results for redacted approved items" | replace/prune; see current owner scenarios | rendering |
| "resolves workflow gates without executing their queue labels" | replace/prune; see current owner scenarios | rendering |
| "attaches notes and filters approval by risk" | replace/prune; see current owner scenarios | parsing |
| "reports an empty risk selection and a raced approval" | replace/prune; see current owner scenarios | rendering |
| "rejects every pending item with a shared reason" | replace/prune; see current owner scenarios | rendering |
| "filters rejection by risk and handles empty or raced selections" | replace/prune; see current owner scenarios | parsing |
| "requires confirmation for %s unless --yes is supplied" | retain rewritten CLI boundary | confirmation |
| "filters the reviewed batch, forwards notes, and reports partial failure with a nonzero exit" | retain rewritten CLI boundary | exit-status |
| "forwards the rejection reason to the selected items and reports skipped races" | retain rewritten CLI boundary | parsing |
| "prints the selected risk when a batch is empty" | retain rewritten CLI boundary | parsing |

### src/modules/approval-queue/cli-history.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/cli-history.test.ts](../../../src/modules/approval-queue/cli-history.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints empty history and excludes pending approvals" | replace/prune; see current owner scenarios | rendering |
| "lists and filters approved and rejected items" | replace/prune; see current owner scenarios | parsing |
| "strips terminal and bidi controls from resolved queue text" | replace/prune; see current owner scenarios | terminal |
| "limits results" | replace/prune; see current owner scenarios | rendering |
| "rejects an invalid status" | replace/prune; see current owner scenarios | parsing |
| "filters by duration" | replace/prune; see current owner scenarios | parsing |
| "prints the empty history message" | retain rewritten CLI boundary | rendering |
| "applies status, duration and limit options to the displayed history" | retain rewritten CLI boundary | parsing |
| "sanitizes resolved notes and rejection reasons" | retain rewritten CLI boundary | rendering |
| "rejects an invalid status with exit status 1" | retain rewritten CLI boundary | exit-status |

### src/modules/approval-queue/cli-list.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/cli-list.test.ts](../../../src/modules/approval-queue/cli-list.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints an empty list and accurate counts" | replace/prune; see current owner scenarios | rendering |
| "lists the safe review descriptor without exposing credentials" | replace/prune; see current owner scenarios | rendering |
| "strips terminal controls from pending queue text" | replace/prune; see current owner scenarios | terminal |
| "strips Unicode bidi controls from pending queue text" | replace/prune; see current owner scenarios | terminal |
| "rejects a pending item with an optional reason" | replace/prune; see current owner scenarios | parsing |
| "rejects invalid target %s" | replace/prune; see current owner scenarios | parsing |
| "prints empty wording and a machine-readable count" | retain rewritten CLI boundary | rendering |
| "renders review input, reason, source and context without terminal or bidi controls" | retain rewritten CLI boundary | terminal |
| "forwards the optional rejection reason and prints the result" | retain rewritten CLI boundary | parsing |
| "rejects malformed %s ids before calling the client" | retain rewritten CLI boundary | rendering |

### src/modules/approval-queue/cli.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/cli.test.ts](../../../src/modules/approval-queue/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "shows the exact credential-safe operation and waits for confirmation before executing" | replace/prune; see current owner scenarios | confirmation |
| "keeps the approval pending when the operator declines after review" | replace/prune; see current owner scenarios | rendering |
| "does not re-execute approvals the daemon already executed" | replace/prune; see current owner scenarios | rendering |
| "resolves workflow gates without trying to execute their queue label as a tool" | replace/prune; see current owner scenarios | rendering |
| "rejects invalid target %s" | replace/prune; see current owner scenarios | parsing |
| "shows the safe descriptor before confirming and forwards its digest and note" | retain rewritten CLI boundary | confirmation |
| "does not submit a declined review" | retain rewritten CLI boundary | confirmation |
| "labels workflow gate confirmation without promising tool execution" | retain rewritten CLI boundary | confirmation |
| "exits nonzero and prints a recovery instruction for a changed review" | retain rewritten CLI boundary | exit-status |
| "reports a failed execution on stderr with exit status 1" | retain rewritten CLI boundary | exit-status |

### src/modules/approval-queue/daemon-client-mutations.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/daemon-client-mutations.test.ts](../../../src/modules/approval-queue/daemon-client-mutations.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "routes reject with an encoded id and reason body" | retain | owner behavior (outside CLI) |
| "routes reject without a reason as an undefined reason body" | retain | owner behavior (outside CLI) |
| "threads scopeId through list and mutations" | retain | owner behavior (outside CLI) |
| "collapses a null response from %s into not_found" | retain | owner behavior (outside CLI) |
| "collapses an invalid-id response from %s" | retain | owner behavior (outside CLI) |
| "collapses unavailable input and scope mismatch responses" | retain | owner behavior (outside CLI) |
| "throws typed unknown-scope errors" | retain | owner behavior (outside CLI) |

### src/modules/approval-queue/local-client-execution.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/local-client-execution.test.ts](../../../src/modules/approval-queue/local-client-execution.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "dispatches through the daemon runtime registered after client construction" | retain | owner behavior (outside CLI) |

### src/modules/approval-queue/routes.test.ts

Production owner: approval-queue. Cadence: owner. Retained suite: [src/modules/approval-queue/routes.test.ts](../../../src/modules/approval-queue/routes.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "handleListApprovals returns daemon response when client succeeds" | retain | owner behavior (outside CLI) |
| "handleListApprovals falls back to direct read when client returns null" | retain | owner behavior (outside CLI) |
| "handleApproveApproval returns daemon response when client succeeds" | retain | owner behavior (outside CLI) |
| "handleApproveApproval relays daemon 409 without falling back to a local approval" | retain | owner behavior (outside CLI) |
| "handleApproveApproval reports daemon transport failure without local fallback" | retain | owner behavior (outside CLI) |
| "handleRejectApproval returns daemon response when client succeeds" | retain | owner behavior (outside CLI) |

### src/modules/architecture-gardener/status.test.ts

Production owner: architecture-gardener. Cadence: owner. Retained suite: [src/modules/architecture-gardener/status.test.ts](../../../src/modules/architecture-gardener/status.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "buildArchitectureGardenerStatus aggregates summary metrics correctly" | retain | owner behavior (outside CLI) |

### src/modules/autonomy/agy-continuous-canary-cli.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/agy-continuous-canary-cli.test.ts](../../../src/modules/autonomy/agy-continuous-canary-cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "uses window-local observations and actual dismissal time" | retain | owner behavior (outside CLI) |
| "recognizes executed code-step agent contracts without an agent-typed step" | retain | owner behavior (outside CLI) |
| "carries active runs across windows, grounds review, and suppresses review during an output incident" | retain | owner behavior (outside CLI) |

### src/modules/autonomy/report/render-control-coverage.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/render-control-coverage.test.ts](../../../src/modules/autonomy/report/render-control-coverage.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders an empty coverage placeholder" | retain | rendering |
| "renders gap counts, async reviewer timing, and recent artifacts" | retain | rendering |

### src/modules/autonomy/report/render-owner-interventions.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/render-owner-interventions.test.ts](../../../src/modules/autonomy/report/render-owner-interventions.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders refs without raw prompts, answers, secrets, or cost fields" | retain | rendering |

### src/modules/autonomy/report/render-populated.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/render-populated.test.ts](../../../src/modules/autonomy/report/render-populated.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "includes priority mix and explorer additions when populated" | retain | rendering |

### src/modules/autonomy/report/render-review-scrutiny.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/render-review-scrutiny.test.ts](../../../src/modules/autonomy/report/render-review-scrutiny.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "emits a placeholder when reviewer artifacts are absent" | retain | rendering |
| "renders reviewer counts and thin acceptance refs" | retain | rendering |

### src/modules/autonomy/report/render.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/render.test.ts](../../../src/modules/autonomy/report/render.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders all dimension headings even when data is empty" | retain | rendering |
| "emits placeholder lines when sections are empty" | retain | rendering |
| "renders trajectory observations without prescribing repair work" | retain | rendering |
| "renders small-sample process-discipline groups without cost fields" | retain | rendering |
| "renders post-completion corrective follow-ups without cost fields" | retain | rendering |

### src/modules/autonomy/report/report-cli-process-discipline.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/report-cli-process-discipline.test.ts](../../../src/modules/autonomy/report/report-cli-process-discipline.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "--json includes the process-discipline report section" | retain | parsing |

### src/modules/autonomy/report/report-cli-supervision-load.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/report-cli-supervision-load.test.ts](../../../src/modules/autonomy/report/report-cli-supervision-load.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders the supervision-load section" | retain | rendering |
| "--json emits the structured supervision-load payload" | retain | parsing |
| "keeps canonical historical terminal runs reportable" | retain | rendering |
| "strips terminal controls from approval-derived top references" | retain | terminal |
| "strips terminal controls from active-run workstream scope ids" | retain | terminal |

### src/modules/autonomy/report/report-cli.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/report-cli.test.ts](../../../src/modules/autonomy/report/report-cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders the report from the current project state" | retain | rendering |
| "--json emits the structured report payload" | retain | parsing |
| "respects --days override" | retain | parsing |
| "rejects non-positive --days values" | retain | parsing |
| "renders focused source-to-decision coverage" | retain | terminal |
| "emits source coverage JSON" | retain | rendering |

### src/modules/autonomy/report/report-shadow-semantic-reviews.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/report-shadow-semantic-reviews.test.ts](../../../src/modules/autonomy/report/report-shadow-semantic-reviews.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "reports catches and skipped target resolution" | retain | owner behavior (outside CLI) |

### src/modules/autonomy/report/source-decision-coverage.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/report/source-decision-coverage.test.ts](../../../src/modules/autonomy/report/source-decision-coverage.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "groups source coverage by disposition and deterministic mapping status" | retain | owner behavior (outside CLI) |
| "flags stale snapshots without inventing a task mapping" | retain | owner behavior (outside CLI) |
| "renders a sample section with adopted, open, rejected, and unmapped sources" | retain | owner behavior (outside CLI) |

### src/modules/autonomy/workflows/attention-digest/attention-cli.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/workflows/attention-digest/attention-cli.test.ts](../../../src/modules/autonomy/workflows/attention-digest/attention-cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints the same body renderOnDemandAttention produces when items exist" | retain | rendering |
| "prints the no-items reply when nothing warrants attention" | retain | rendering |
| "--json emits the structured AttentionItem[] payload and rendered text" | retain | parsing |
| "does not emit workflow.attention.digest" | replace/prune; see current owner scenarios | rendering |

### src/modules/autonomy/workflows/attention-digest/step.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/workflows/attention-digest/step.test.ts](../../../src/modules/autonomy/workflows/attention-digest/step.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "does not emit before 10 invocations" | retain | owner behavior (outside CLI) |
| "does not emit at 10 invocations when nothing warrants attention" | retain | owner behavior (outside CLI) |
| "surfaces a durable exhausted-investigation attention disposition" | retain | owner behavior (outside CLI) |
| "emits workflow.attention.digest at exactly 10 invocations when builder failure streak >= 3" | retain | owner behavior (outside CLI) |
| "does not emit at 10 invocations when builder failures < 3" | retain | owner behavior (outside CLI) |
| "emits digest when multiple tasks are blocked" | retain | owner behavior (outside CLI) |
| "emits digest when the open task queue is empty" | retain | owner behavior (outside CLI) |
| "does not emit when the open queue is populated and nothing else warrants attention" | retain | owner behavior (outside CLI) |
| "includes multiple attention items in one digest" | retain | owner behavior (outside CLI) |
| "emits digest every 10 invocations, not just once" | retain | owner behavior (outside CLI) |
| "digest text starts with attention digest header" | retain | owner behavior (outside CLI) |
| "emits digest without emit callback (no-op, no throw)" | retain | owner behavior (outside CLI) |
| "lists all run dirs to verify test isolation" | retain | owner behavior (outside CLI) |
| "emits digest when N builder runs have completed-with-warnings (default N=3, M=10)" | retain | owner behavior (outside CLI) |
| "does not emit when fewer than N builder runs have warnings" | retain | owner behavior (outside CLI) |
| "respects custom N and M env vars" | retain | owner behavior (outside CLI) |
| "includes warning type in detail when all warnings share the same type" | retain | owner behavior (outside CLI) |
| "does not include type in detail when warnings have mixed types" | retain | owner behavior (outside CLI) |
| "does not count non-builder warning runs" | retain | owner behavior (outside CLI) |
| "does not surface a task that has not reached the threshold" | retain | owner behavior (outside CLI) |
| "surfaces a task sitting exactly at the threshold" | retain | owner behavior (outside CLI) |
| "surfaces a task one day past the threshold" | retain | owner behavior (outside CLI) |
| "labels an owner-blocker task differently from a stale blocker" | retain | owner behavior (outside CLI) |
| "suppresses the aggregate line when every blocked task is long-blocked" | retain | owner behavior (outside CLI) |
| "caps individual items at five and summarizes the tail" | retain | owner behavior (outside CLI) |
| "respects KOTA_DIGEST_BLOCKED_AGE_DAYS override" | retain | owner behavior (outside CLI) |
| "fails closed against a centralized active-run authority" | retain | owner behavior (outside CLI) |
| "returns the same body cadence would emit when items exist" | retain | owner behavior (outside CLI) |
| "returns the short fixed reply when nothing warrants attention" | retain | owner behavior (outside CLI) |
| "does not depend on cadence state" | retain | owner behavior (outside CLI) |
| "does not emit workflow.attention.digest" | retain | owner behavior (outside CLI) |
| "suppresses an aged owner-decision when a fresh ask marker is on the body" | retain | owner behavior (outside CLI) |
| "suppresses an aged operator-capture when a fresh instructed marker is on the body" | retain | owner behavior (outside CLI) |
| "surfaces an aged operator-capture again once the marker ages past 14 days" | retain | owner behavior (outside CLI) |
| "surfaces an aged owner-decision precondition past 14 days" | retain | owner behavior (outside CLI) |
| "does not surface an operator-capture precondition under the threshold" | retain | owner behavior (outside CLI) |

### src/modules/autonomy/workflows/daily-digest/digest-cli.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/workflows/daily-digest/digest-cli.test.ts](../../../src/modules/autonomy/workflows/daily-digest/digest-cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints the same body renderOnDemandDigest produces" | retain | rendering |
| "--json emits the structured DailyDigestData payload" | retain | parsing |
| "does not create cadence state or emit workflow.daily.digest" | replace/prune; see current owner scenarios | rendering |

### src/modules/autonomy/workflows/daily-digest/on-demand.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/workflows/daily-digest/on-demand.test.ts](../../../src/modules/autonomy/workflows/daily-digest/on-demand.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "returns the rendered digest body without creating cadence state" | retain | owner behavior (outside CLI) |
| "does not emit workflow.daily.digest" | retain | owner behavior (outside CLI) |
| "uses the persisted cadence snapshot for the queue delta baseline" | retain | owner behavior (outside CLI) |
| "reads pending owner questions from the requested scope directory" | retain | owner behavior (outside CLI) |

### src/modules/autonomy/workflows/daily-digest/render.test.ts

Production owner: autonomy. Cadence: owner. Retained suite: [src/modules/autonomy/workflows/daily-digest/render.test.ts](../../../src/modules/autonomy/workflows/daily-digest/render.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders quiet window with no-activity message" | retain | rendering |
| "renders active window with all seven categories" | retain | rendering |
| "is deterministic for the same input" | replace/prune; see current owner scenarios | rendering |
| "contains no ANSI escape sequences (chat-channel safe)" | replace/prune; see current owner scenarios | terminal |
| "matches the committed sample-active fixture" | replace/prune; see current owner scenarios | rendering |
| "matches the committed sample-quiet fixture" | replace/prune; see current owner scenarios | rendering |

### src/modules/browser/browser-interaction-tools.test.ts

Production owner: browser. Cadence: owner. Retained suite: [src/modules/browser/browser-interaction-tools.test.ts](../../../src/modules/browser/browser-interaction-tools.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "rejects a missing or invalid URL" | retain | owner behavior (outside CLI) |
| "routes session context and returns the final page identity" | retain | owner behavior (outside CLI) |
| "waits for an optional selector" | retain | owner behavior (outside CLI) |
| "returns navigation errors" | retain | owner behavior (outside CLI) |
| "requires a selector" | retain | owner behavior (outside CLI) |
| "clicks the selected element" | retain | owner behavior (outside CLI) |
| "requires selector and text" | retain | owner behavior (outside CLI) |
| "types text into an input" | retain | owner behavior (outside CLI) |
| "clears the field first when requested" | retain | owner behavior (outside CLI) |

### src/modules/browser/cli.test.ts

Production owner: browser. Cadence: owner. Retained suite: [src/modules/browser/cli.test.ts](../../../src/modules/browser/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "hydrates runtime modules before invoking source-access reader tools" | retain | packaging |

### src/modules/browser/rendered-article-read.test.ts

Production owner: browser. Cadence: owner. Retained suite: [src/modules/browser/rendered-article-read.test.ts](../../../src/modules/browser/rendered-article-read.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "rejects missing or non-http URLs" | retain | owner behavior (outside CLI) |
| "returns rendered text with URL and title headers" | retain | owner behavior (outside CLI) |
| "flags a rendered Cloudflare challenge" | retain | owner behavior (outside CLI) |
| "detects an empty challenge from title and final URL" | retain | owner behavior (outside CLI) |
| "truncates excessively long article text" | retain | owner behavior (outside CLI) |
| "surfaces timeout errors in a typed form" | retain | owner behavior (outside CLI) |
| "honors a custom selector hint" | retain | owner behavior (outside CLI) |

### src/modules/cli/navigator-actions.test.ts

Production owner: cli. Cadence: owner. Retained suite: [src/modules/cli/navigator-actions.test.ts](../../../src/modules/cli/navigator-actions.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "executes the selected action from the actions pane and refreshes navigator state" | retain | parsing |
| "targets the active run when the selected abort-run action has no explicit parameters" | retain | parsing |
| "targets the first queued run when the selected cancel action has no explicit parameters" | retain | parsing |
| "targets the first failed recent run when the selected retry action has no explicit parameters" | retain | parsing |

### src/modules/cli/navigator-operator-console.test.ts

Production owner: cli. Cadence: owner. Retained suite: [src/modules/cli/navigator-operator-console.test.ts](../../../src/modules/cli/navigator-operator-console.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders the first-screen overview from shared Status, Work, Inbox, Setup, Modules, Agents, and Stores surfaces" | retain | terminal |
| "refuses typed action execution for secret parameter fields" | retain | rendering |
| "renders explicit daemon-down guidance for errors and empty local surface bundles" | retain | rendering |

### src/modules/cli/navigator-terminal-prompt.test.ts

Production owner: cli. Cadence: owner. Retained suite: [src/modules/cli/navigator-terminal-prompt.test.ts](../../../src/modules/cli/navigator-terminal-prompt.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "reads direct raw keys on the TTY path and reserves prompt text for line commands" | retain | terminal |
| "masks command-palette action parameters before they reach the terminal transcript" | retain | terminal |

### src/modules/cli/navigator.test.ts

Production owner: cli. Cadence: owner. Retained suite: [src/modules/cli/navigator.test.ts](../../../src/modules/cli/navigator.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "refuses non-TTY launch and prints the equivalent one-shot hint" | retain | terminal |
| "renders shared UI surfaces, opens a Work intent surface, and quits cleanly" | retain | rendering |
| "refreshes the shared surface bundle on command" | retain | rendering |
| "renders command palette, resize, theme, and keybinding states" | retain | terminal |
| "drives keyboard focus and selected surface/action movement deterministically" | retain | terminal |
| "subscribes to live daemon UI events and refreshes the current frame" | retain | rendering |
| "executes a typed shared UI action with JSON parameters" | retain | rendering |
| "requires confirmation for write actions when --yes is absent" | retain | confirmation |
| "keeps disabled actions local instead of executing them" | retain | rendering |
| "surfaces contract errors in place rather than swallowing them" | retain | rendering |

### src/modules/commands/catalog.test.ts

Production owner: commands. Cadence: owner. Retained suite: [src/modules/commands/catalog.test.ts](../../../src/modules/commands/catalog.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "lists workflow commands only for workflows tagged with COMMAND_WORKFLOW_TAG" | retain | owner behavior (outside CLI) |
| "lists every contributed skill as skill:<name>" | retain | owner behavior (outside CLI) |
| "resolves a workflow command to a workflow action" | retain | owner behavior (outside CLI) |
| "refuses to resolve an untagged workflow as a slash command" | retain | owner behavior (outside CLI) |
| "resolves a skill command to the skill's prompt body" | retain | owner behavior (outside CLI) |
| "returns null for unknown command names" | retain | owner behavior (outside CLI) |
| "sorts commands alphabetically by name" | retain | owner behavior (outside CLI) |

### src/modules/commands/daemon-control.test.ts

Production owner: commands. Cadence: owner. Retained suite: [src/modules/commands/daemon-control.test.ts](../../../src/modules/commands/daemon-control.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "declares /commands routes with read/control capability scopes" | retain | owner behavior (outside CLI) |
| "requires the daemon bearer token on both routes" | retain | owner behavior (outside CLI) |
| "returns 503 when no catalog is registered" | retain | owner behavior (outside CLI) |
| "returns the catalog list when registered" | retain | owner behavior (outside CLI) |
| "returns 503 when no catalog is registered" | retain | owner behavior (outside CLI) |
| "returns 400 for invalid JSON body" | retain | owner behavior (outside CLI) |
| "returns 400 when name is missing or empty" | retain | owner behavior (outside CLI) |
| "returns 404 when the command is unknown" | retain | owner behavior (outside CLI) |
| "returns 200 with the skill prompt for a skill command" | retain | owner behavior (outside CLI) |
| "returns 200 with queued workflow and runId when the dispatcher accepts" | retain | owner behavior (outside CLI) |
| "returns 409 when the dispatcher reports the workflow is already queued" | retain | owner behavior (outside CLI) |
| "returns 400 when the dispatcher reports a generic enqueue failure" | retain | owner behavior (outside CLI) |
| "returns 503 when the workflow-dispatcher seam is not registered" | retain | owner behavior (outside CLI) |
| "throws at server construction if two contributions claim the same route key" | retain | owner behavior (outside CLI) |

### src/modules/completion/completion.test.ts

Production owner: completion. Cadence: owner. Retained suite: [src/modules/completion/completion.test.ts](../../../src/modules/completion/completion.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "generates zsh completion script with top-level commands" | retain | parsing |
| "generates bash completion script with top-level commands" | retain | parsing |
| "zsh completion includes subcommands of workflow" | retain | parsing |
| "bash completion includes flags for subcommands" | retain | parsing |
| "auto-detects zsh from SHELL env" | retain | parsing |
| "auto-detects bash from SHELL env" | retain | parsing |
| "exits with error for unknown shell" | retain | exit-status |

### src/modules/config/config.test.ts

Production owner: config. Cadence: owner. Retained suite: [src/modules/config/config.test.ts](../../../src/modules/config/config.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "shows no sources when no config files exist" | retain | rendering |
| "shows the scope source path when scope config exists" | retain | rendering |
| "includes resolved config in output" | retain | rendering |
| "warns about unknown top-level keys" | retain | rendering |
| "does not warn about module-registered config keys" | retain | rendering |
| "warns about keys not in core or module sets" | retain | rendering |
| "does not warn about known keys" | retain | rendering |
| "--json outputs only resolved config JSON" | retain | parsing |
| "--json does not include source headers or warnings" | retain | parsing |
| "warns when untrusted scope config is ignored" | retain | rendering |
| "prints top-level string value" | retain | rendering |
| "prints nested value via dot-notation" | retain | rendering |
| "exits non-zero for missing key" | retain | exit-status |
| "writes string value when not valid JSON" | retain | rendering |
| "creates the scope config file if it does not exist" | delete: preceding setter reads the created file and proves its value | owner behavior (outside CLI) |
| "supports nested key via dot-notation" | retain | rendering |
| "warns for unrecognised key" | retain | rendering |
| "does not warn when setting a module-registered key" | retain | rendering |
| "prints the path to the schema file" | retain | rendering |
| "schema file exists and is valid JSON Schema" | retain | owner behavior (outside CLI) |
| "--print outputs schema content" | retain | parsing |
| "committed schema matches generated output (run pnpm build:schema to fix)" | retain | owner behavior (outside CLI) |


### src/modules/daemon-ops/daemon-help.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/daemon-help.test.ts](../../../src/modules/daemon-ops/daemon-help.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "identifies foreground daemon mode as a host dashboard" | retain | rendering |
| "points daemon start operators to the console and workflow controls" | retain | rendering |

### src/modules/daemon-ops/daemon-service-commands.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/daemon-service-commands.test.ts](../../../src/modules/daemon-ops/daemon-service-commands.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "bootstraps launchd through the GUI domain and waits for daemon readiness" | retain | rendering |
| "rolls back launchd registration and service file when readiness fails" | retain | rendering |
| "removes the new service file when launchd rejects bootstrap" | retain | rendering |
| "preserves the launchd service file when bootout fails during uninstall" | retain | rendering |
| "preserves the systemd service file when disable fails during uninstall" | retain | rendering |
| "refuses installation while another daemon control plane is already ready" | retain | rendering |
| "rolls back a systemd install whose daemon never becomes ready" | retain | rendering |
| "bounds every service supervisor command" | retain | rendering |

### src/modules/daemon-ops/dashboard-control-affordances.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/dashboard-control-affordances.test.ts](../../../src/modules/daemon-ops/dashboard-control-affordances.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders a controls footer with the canonical operator commands" | retain | rendering |
| "shows paused dispatch with the exact resume and operator-client paths" | retain | rendering |
| "shows dispatch-window blockage with inspection and reload paths" | retain | rendering |
| "shows idle no-actionable-work state with inbox and navigator paths" | retain | rendering |

### src/modules/daemon-ops/dashboard-render-activity.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/dashboard-render-activity.test.ts](../../../src/modules/daemon-ops/dashboard-render-activity.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "skips the Work section entirely when the task queue has no open signal" | retain | rendering |
| "does not report parked open tasks as dispatchable work" | retain | rendering |
| "shows last completed workflow" | retain | rendering |
| "shows log messages after a labeled activity rule" | retain | rendering |
| "does not render decorative dashes that look like a second frame" | retain | rendering |
| "shows a single-cell paused indicator" | retain | rendering |
| "truncates logs to 20 lines" | retain | rendering |
| "activity rule fills each common terminal width" | retain | rendering |

### src/modules/daemon-ops/dashboard-render-status.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/dashboard-render-status.test.ts](../../../src/modules/daemon-ops/dashboard-render-status.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "shows daemon header with pid and uptime" | retain | rendering |
| "shows completed runs and session count" | retain | rendering |
| "shows definition count" | retain | rendering |
| "never collides completed run count with the next label at high counts" | retain | rendering |
| "shows stopping and stopped status" | retain | rendering |
| "shows paused indicator when dispatch is paused" | retain | rendering |
| "shows provider incidents instead of an idle state" | retain | rendering |
| "shows active runs with duration" | retain | rendering |
| "shows pending run count" | retain | rendering |
| "shows pending run names, trigger events, and readiness" | retain | rendering |
| "shows task queue context and omits zero-valued states" | retain | rendering |

### src/modules/daemon-ops/dashboard-render-transcript.test.ts

Production owner: daemon-ops. Cadence: owner. Deleted suite; before evidence is available at the baseline Git revision.

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders cleanly at ${width} columns` | delete; owning mechanism/focused scenario retained (owner mapping above) | rendering |

### src/modules/daemon-ops/dashboard.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/dashboard.test.ts](../../../src/modules/daemon-ops/dashboard.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "guarantees at least two spaces between value and next label" | retain | rendering |
| "aligns labels and values across rows by widest entry per column" | retain | rendering |
| "places single-cell rows without padding the only value" | retain | rendering |
| "captures stderr log messages into the dashboard" | retain | terminal |
| "strips [kota-daemon] prefix from captured logs" | retain | rendering |
| "coalesces stderr bursts into one cached render" | retain | terminal |
| "does not overlap expensive projection refreshes" | retain | rendering |
| "restores stderr on stop" | retain | terminal |
| "reports dashboard render failures through the original stderr writer" | retain | terminal |
| "enters the alternate screen buffer on a TTY so refreshes cannot leak into scrollback" | retain | terminal |
| "does not enter the alternate screen buffer in non-TTY contexts" | retain | terminal |

### src/modules/daemon-ops/format-utils.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/format-utils.test.ts](../../../src/modules/daemon-ops/format-utils.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "formats seconds" | retain | rendering |
| "formats minutes and seconds" | retain | rendering |
| "formats hours and minutes" | retain | rendering |
| "formats days and hours" | retain | rendering |
| "formats under a minute" | retain | rendering |
| "formats minutes and seconds" | retain | rendering |
| "shows seconds ago" | retain | rendering |
| "shows minutes ago" | retain | rendering |
| "shows hours ago" | retain | rendering |
| "extracts the last segment after hyphen" | retain | rendering |
| "handles short IDs with no hyphens" | retain | rendering |
| "handles IDs with a single hyphen" | retain | rendering |

### src/modules/daemon-ops/index.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/index.test.ts](../../../src/modules/daemon-ops/index.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "shows relative uptime instead of raw seconds" | retain | rendering |
| "shows relative time for start instead of ISO timestamp" | retain | rendering |
| "shows active runs with workflow name and duration" | retain | rendering |
| "abbreviates run IDs in active runs" | retain | rendering |
| "shows pending runs summarized with overflow count" | retain | rendering |
| "shows whether the OS service unit is installed" | retain | rendering |
| "shows paused status" | retain | rendering |
| "renders state and activity as visually separated dashboard sections" | retain | rendering |
| "surfaces a paused notice section above state when scheduler is paused" | retain | rendering |

### src/modules/daemon-ops/local-ui-client.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/local-ui-client.test.ts](../../../src/modules/daemon-ops/local-ui-client.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "uses the module runtime's shared UI assembler" | retain | owner behavior (outside CLI) |
| "executes local setup routes with the scope projected into the action" | retain | owner behavior (outside CLI) |
| "executes daemon UI action requests through the same scoped local client" | retain | owner behavior (outside CLI) |
| "uses the projected scope for local namespace action execution" | retain | owner behavior (outside CLI) |

### src/modules/daemon-ops/operator-inbox.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/operator-inbox.test.ts](../../../src/modules/daemon-ops/operator-inbox.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders a clear inbox when no attention items exist" | retain | rendering |
| "aggregates runtime warnings, approvals, owner questions, blocked tasks, setup gaps, and failed runs" | retain | rendering |
| "surfaces hidden setup visibility without inventing requirement rows" | retain | rendering |
| "fails when a listed blocked task has no typed unblock precondition" | retain | rendering |

### src/modules/daemon-ops/operator-ui-continuity.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/operator-ui-continuity.test.ts](../../../src/modules/daemon-ops/operator-ui-continuity.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "builds a projection and shared UI surface from typed namespace reads" | retain | owner behavior (outside CLI) |
| "redacts sensitive memory and knowledge text before rendering" | retain | owner behavior (outside CLI) |
| "renders empty, blocked, and failed states distinctly" | retain | owner behavior (outside CLI) |

### src/modules/daemon-ops/operator-ui.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/operator-ui.test.ts](../../../src/modules/daemon-ops/operator-ui.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "builds a typed Status surface with summary, warnings, and direct actions" | retain | rendering |
| "builds a typed Inbox surface with item actions and an empty state arm" | retain | rendering |
| "builds a richer shared operator-control surface with typed daemon actions" | retain | rendering |
| "renders the shared Status and Inbox surfaces through the CLI renderer" | retain | rendering |
| "projects the complete Add Scope lifecycle through one generated UI contract" | retain | rendering |
| "applies Add Scope through the canonical plan and apply client operations" | retain | rendering |
| "rejects a selected-paths write boundary without any selected paths" | retain | parsing |
| "uses the canonical onboarding decoder for direct namespace execution" | retain | rendering |
| "returns canonical setup, plan, mutation, readiness, and error details" | retain | rendering |
| "returns the durable operation receipt when Add Scope apply fails" | retain | rendering |
| "rejects Add Scope execution until the renderer records explicit confirmation" | retain | confirmation |
| "rejects malformed Add Scope %s before dispatch" | retain | rendering |
| "executes typed daemon-route UI actions through an injected route executor" | retain | rendering |
| "executes the Status daemon.start client-namespace action through an injected namespace executor" | retain | rendering |
| "executes needs-setup daemon-route UI actions so setup controls can start" | retain | rendering |

### src/modules/daemon-ops/scopes-authority-daemon-client.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/scopes-authority-daemon-client.test.ts](../../../src/modules/daemon-ops/scopes-authority-daemon-client.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "routes authority inspection, validation, and apply through typed scope endpoints" | retain | owner behavior (outside CLI) |
| "does not disclose a reusable credential to a fake endpoint" | retain | owner behavior (outside CLI) |
| "rejects authority apply before transport for a non-interactive client" | retain | owner behavior (outside CLI) |

### src/modules/daemon-ops/scopes-cli.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/scopes-cli.test.ts](../../../src/modules/daemon-ops/scopes-cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "exposes canonical scope verbs without retired aliases" | replace/prune; see current owner scenarios | rendering |
| "list --json prints scopes + active selection on a daemon-up call" | retain | parsing |
| "list reports daemon_required on the local-handler arm with exit code 1" | retain | exit-status |
| "select <id> calls scopes.use and prints the new active selection" | retain | rendering |
| "select --clear calls scopes.use(null) and reports the cleared selection" | retain | parsing |
| "select rejects unknown ids with a non-zero exit code" | retain | exit-status |
| "select rejects passing both <id> and --clear without calling the daemon" | retain | parsing |
| "select without an id or --clear flag is rejected" | retain | parsing |
| "configure delegates explicit operator choices to the scopes client" | retain | rendering |
| "sanitizes untrusted onboarding fields before terminal rendering" | retain | rendering |
| "sanitizes the directory and plan id before the onboarding confirmation prompt" | retain | confirmation |
| "add --json keeps discovered existing state beside an idempotent operation" | retain | parsing |
| "add replans a removed scope with its accepted choices and current inspection" | retain | rendering |
| "status renders durable progress, readiness reasons, mutations, and errors" | retain | rendering |
| "onboarding status explains live improvement authority and readiness blockers" | retain | rendering |

### src/modules/daemon-ops/scopes-local.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/scopes-local.test.ts](../../../src/modules/daemon-ops/scopes-local.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "uses the daemon scope operator provider for shared UI lifecycle actions" | retain | owner behavior (outside CLI) |
| "keeps offline local clients explicit" | retain | owner behavior (outside CLI) |
| "normalizes invalid local inspection paths like the daemon route" | retain | owner behavior (outside CLI) |

### src/modules/daemon-ops/status-cli-gather.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/status-cli-gather.test.ts](../../../src/modules/daemon-ops/status-cli-gather.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "joins durable run records to live repository workspace evidence" | retain | owner behavior (outside CLI) |
| "preserves an unavailable durable projection without probing workspaces" | retain | owner behavior (outside CLI) |

### src/modules/daemon-ops/status-cli-worktrees.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/status-cli-worktrees.test.ts](../../../src/modules/daemon-ops/status-cli-worktrees.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders durable state, resources, processes, sandbox Git evidence, wait, and error" | retain | rendering |
| "reports unavailable live Git evidence without inventing branch state" | retain | rendering |
| "shows when the durable projection database is unavailable" | retain | rendering |
| "writes a deterministic CLI transcript for the durable run projection" | replace/prune; see current owner scenarios | rendering |

### src/modules/daemon-ops/status-cli.test.ts

Production owner: daemon-ops. Cadence: owner. Retained suite: [src/modules/daemon-ops/status-cli.test.ts](../../../src/modules/daemon-ops/status-cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "shows daemon as not running when offline" | retain | rendering |
| "shows daemon as running with pid and uptime" | retain | rendering |
| "shows active and queued run counts" | retain | rendering |
| "shows when workflow dispatch is paused" | retain | rendering |
| "shows session count" | retain | rendering |
| "renders durable run counts while dispatch is offline" | retain | rendering |
| "can explain whether status came from the daemon or local offline files" | retain | rendering |
| "marks pending approvals with attention note" | retain | rendering |
| "shows no attention note when approvals are zero" | retain | rendering |
| "formats uptime under one hour as minutes only" | retain | rendering |
| "shows the scope name and directory at the top of the snapshot" | retain | rendering |
| "reports a missing control file in the offline branch" | retain | rendering |
| "flags a stranded daemon process when no control API is published" | retain | rendering |
| "reports a stale control file with the doctor hint and base URL" | retain | rendering |
| "reports a fresh control file and the daemon URL when running" | retain | rendering |
| "flags a wrong-scope mismatch when daemon /identity reports another scope" | retain | rendering |
| "shows the daemon's scope alongside the selected scope when they match" | retain | parsing |
| "shows the active scope name and path when the daemon hosts more than one scope" | retain | rendering |
| "omits the active-scope line for single-scope daemons" | retain | rendering |
| "never includes a Bearer token marker in the rendered output" | retain | rendering |
| "renders the daemon-served dashboard URL when /identity advertises it" | retain | rendering |
| "explains why the dashboard is not available when /identity reports an unavailable capability" | retain | rendering |
| "omits the Dashboard line when the daemon never answered /identity" | retain | rendering |
| "does not expose removed-worktree compatibility flags" | replace/prune; see current owner scenarios | rendering |
| "joins the daemon base URL with the advertised relative path" | retain | rendering |
| "preserves a fully qualified path so a configured external dev URL passes through unchanged" | retain | rendering |
| "forwards the unavailable reason and message verbatim" | retain | parsing |
| "omits the message when the daemon does not include one" | retain | rendering |
| "writes a transcript snapshot covering connected, missing, stale, and wrong-scope states" | replace/prune; see current owner scenarios | rendering |
| "returns missing when no control file exists" | retain | rendering |
| "returns fresh when the recorded pid is alive" | retain | rendering |
| "returns stale when the recorded pid is not alive" | retain | rendering |
| "returns unreadable when the file is not valid JSON" | retain | rendering |
| "returns unreadable when required fields are missing" | retain | rendering |

### src/modules/eval-harness/agy-model-evaluation-runner.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/agy-model-evaluation-runner.test.ts](../../../src/modules/eval-harness/agy-model-evaluation-runner.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "calibrates verifiers and reaches all three scenario executors with the Antigravity override" | retain | owner behavior (outside CLI) |

### src/modules/eval-harness/agy-model-evaluation-scenarios.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/agy-model-evaluation-scenarios.test.ts](../../../src/modules/eval-harness/agy-model-evaluation-scenarios.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "selects one isolated, scope-checked fixture per required scenario" | retain | owner behavior (outside CLI) |
| "makes instruction and unrelated-path violations first-class failures" | retain | owner behavior (outside CLI) |
| "fails guideline adherence when required trace evidence is absent" | retain | owner behavior (outside CLI) |
| "does not treat unredacted synthetic provider payloads as command evidence" | retain | owner behavior (outside CLI) |
| "fails guideline adherence for a forbidden process action" | retain | owner behavior (outside CLI) |
| "fails repair adherence on the harness-wide commit prohibition" | retain | owner behavior (outside CLI) |
| "passes trace-backed checks when required commands are present" | retain | owner behavior (outside CLI) |

### src/modules/eval-harness/cli-agy-models.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/cli-agy-models.test.ts](../../../src/modules/eval-harness/cli-agy-models.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "forwards repeatable candidates and explicit maximum effort" | retain | parsing |
| "rejects a run before dispatch when isolated execution is not configured" | retain | rendering |

### src/modules/eval-harness/cli-calibration.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/cli-calibration.test.ts](../../../src/modules/eval-harness/cli-calibration.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "aggregates seeded artifacts and prints human-readable summary" | retain | rendering |
| "sets exitCode=2 and emits JSON when gated" | retain | exit-status |
| "reports insufficient-sample when fewer pass verdicts than minSample" | retain | rendering |

### src/modules/eval-harness/cli-fixture-candidates.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/cli-fixture-candidates.test.ts](../../../src/modules/eval-harness/cli-fixture-candidates.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "writes JSON and readable summary artifacts for a bounded run-id scan" | replace with scan option forwarding and summary rendering; lifecycle owned by fixture-candidates domain suites | owner behavior (outside CLI) |
| "creates accepted open tasks when requested" | replace with scan option forwarding and summary rendering; lifecycle owned by fixture-candidates domain suites | owner behavior (outside CLI) |
| "forwards scan options and renders the returned summary and artifact paths" | retain | parsing |


### src/modules/eval-harness/cli-list.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/cli-list.test.ts](../../../src/modules/eval-harness/cli-list.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "emits fixture control decisions and aggregate coverage as JSON" | retain | rendering |
| "prints compact coverage counts and missing-decision warnings" | retain | rendering |

### src/modules/eval-harness/cli-run-options.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/cli-run-options.test.ts](../../../src/modules/eval-harness/cli-run-options.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "threads deliberate container selection into the eval run options" | retain | parsing |
| "threads provider-egress container policy into eval run options" | retain | parsing |
| "accepts OpenRouter as a provider-egress catalog provider" | retain | rendering |
| "rejects container fields unless the operator selects container isolation" | retain | rendering |
| "rejects unsafe recording fixture ids before recorder extraction" | retain | rendering |

### src/modules/eval-harness/cli-run-reporting.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/cli-run-reporting.test.ts](../../../src/modules/eval-harness/cli-run-reporting.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints fixture diagnostics and repeat-unstable fixture rows" | retain | rendering |
| "prints compact code-health warning counts when diagnostics ran" | retain | rendering |
| "prints run-configuration fingerprint summary and mismatch reason" | retain | rendering |

### src/modules/eval-harness/daemon-client-agy.test.ts

Production owner: eval-harness. Cadence: eval. Retained suite: [src/modules/eval-harness/daemon-client-agy.test.ts](../../../src/modules/eval-harness/daemon-client-agy.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "contributes and routes the long-running model evaluation operation" | retain | owner behavior (outside CLI) |

### src/modules/guardrails-audit/cli.test.ts

Production owner: guardrails-audit. Cadence: owner. Retained suite: [src/modules/guardrails-audit/cli.test.ts](../../../src/modules/guardrails-audit/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints no entries message when store is empty" | retain | rendering |
| "prints table with entries" | retain | rendering |
| "passes risk filter to store" | retain | rendering |
| "passes policy filter to store" | retain | rendering |
| "passes limit to store" | retain | rendering |
| "uses default limit of 50" | retain | rendering |
| "displays session column" | retain | rendering |
| "shows dash for missing session" | retain | rendering |
| "prints manifest context columns when entries include manifest data" | retain | rendering |

### src/modules/history/cli.test.ts

Production owner: history. Cadence: owner. Retained suite: [src/modules/history/cli.test.ts](../../../src/modules/history/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders per-conversation lines for non-empty results and defaults to semantic" | retain | rendering |
| "renders the fixed empty-result body when the daemon returns an empty list" | retain | rendering |
| "prints the inline usage hint and skips the request on a whitespace-only query" | retain | rendering |
| "surfaces the semantic-unavailable branch explicitly without degrading to keyword" | retain | rendering |
| "--keyword routes through the keyword search path" | retain | parsing |
| "--no-semantic also routes through the keyword search path" | retain | parsing |
| "--json emits the structured ok:true conversations payload" | retain | parsing |
| "--json emits the structured ok:false reason payload on semantic-unavailable" | retain | parsing |
| "--all clears the cwd filter on the search call" | retain | parsing |
| "defaults to a bounded window and reports window metadata" | retain | rendering |
| "supports metadata-only display without rendering messages" | retain | rendering |
| "rejects malformed show view input before calling the client" | retain | rendering |
| "rejects window-only flags for non-window views" | retain | rendering |
| "explicit run continue resolves to the saved cwd" | retain | rendering |
| "explicit run continue finds a record that exists only in its saved project history" | retain | rendering |
| "bare run continue still filters by the caller cwd" | retain | parsing |
| "missing saved cwd fails validation with the override hint" | retain | rendering |
| "explicit override uses the caller cwd even when the saved cwd is gone" | retain | rendering |

### src/modules/history/history-list-node.test.ts

Production owner: history. Cadence: owner. Retained suite: [src/modules/history/history-list-node.test.ts](../../../src/modules/history/history-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders id/updated/msgs/title columns in ${name} theme at wide width` | retain | rendering |
| `compresses cleanly within a narrow width in ${name} theme` | retain | rendering |
| "declares Title with a maxWidth so long titles do not overflow" | replace/prune; see current owner scenarios | rendering |

### src/modules/knowledge/cli-okf-command.test.ts

Production owner: knowledge. Cadence: owner. Retained suite: [src/modules/knowledge/cli-okf-command.test.ts](../../../src/modules/knowledge/cli-okf-command.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "imports an OKF bundle through the knowledge client and reindexes afterward" | retain | rendering |

### src/modules/knowledge/cli.test.ts

Production owner: knowledge. Cadence: owner. Retained suite: [src/modules/knowledge/cli.test.ts](../../../src/modules/knowledge/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "creates an entry with --content and prints the ID" | retain | parsing |
| "applies --type, --tag, --status, and --scope flags" | retain | parsing |
| "rejects invalid scope" | retain | parsing |
| "reads content from stdin when --content is omitted" | retain | terminal |
| "exports all entries as JSONL by default" | retain | rendering |
| "exports as JSON array with --format json" | retain | parsing |
| "filters by --type" | retain | parsing |
| "filters by --status" | retain | parsing |
| "filters by --tag" | retain | parsing |
| "round-trips through export then import" | replace/prune; see current owner scenarios | rendering |
| "JSONL round-trips through parseImportEntries" | replace/prune; see current owner scenarios | parsing |
| "produces empty output when no entries exist" | retain | rendering |
| "rejects invalid format" | retain | parsing |
| "routes --semantic searches through the active provider semanticSearch" | retain | parsing |

### src/modules/knowledge/knowledge-list-node.test.ts

Production owner: knowledge. Cadence: owner. Retained suite: [src/modules/knowledge/knowledge-list-node.test.ts](../../../src/modules/knowledge/knowledge-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders id/type/status/updated/title columns in ${name} theme` | retain | rendering |
| "fits within a narrow terminal" | retain | rendering |
| "renders id/type/title columns" | retain | rendering |

### src/modules/mcp-registry/index.test.ts

Production owner: mcp-registry. Cadence: owner. Retained suite: [src/modules/mcp-registry/index.test.ts](../../../src/modules/mcp-registry/index.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "fetches one server version from a configurable registry URL and prints mcpServers JSON" | retain | rendering |
| "inspects a private tunnel profile without printing secret values" | retain | rendering |

### src/modules/mcp-server/index.test.ts

Production owner: mcp-server. Cadence: owner. Retained suite: [src/modules/mcp-server/index.test.ts](../../../src/modules/mcp-server/index.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "has correct name and version" | replace/prune; see current owner scenarios | rendering |
| "description mentions Model Context Protocol" | replace/prune; see current owner scenarios | rendering |
| "registers a single mcp-server command" | replace/prune; see current owner scenarios | rendering |
| "accepts --tools, --name, and Streamable HTTP options" | retain | terminal |
| "--name defaults to 'kota'" | replace/prune; see current owner scenarios | parsing |
| "prints the local endpoint when started in Streamable HTTP mode" | retain | terminal |

### src/modules/mcp-server/interoperability.test.ts

Production owner: mcp-server. Cadence: protocol. Retained suite: [src/modules/mcp-server/interoperability.test.ts](../../../src/modules/mcp-server/interoperability.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "lists and calls a production server tool across a real stdio child-process pipe" | retain | protocol |

### src/modules/memory/cli.test.ts

Production owner: memory. Cadence: owner. Retained suite: [src/modules/memory/cli.test.ts](../../../src/modules/memory/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "creates an entry with --content and prints the ID" | retain | parsing |
| "applies --tag flags" | retain | parsing |
| "reads content from stdin when --content is omitted" | retain | terminal |
| "routes --semantic searches through the active provider semanticSearch" | retain | parsing |

### src/modules/memory/memory-list-node.test.ts

Production owner: memory. Cadence: owner. Retained suite: [src/modules/memory/memory-list-node.test.ts](../../../src/modules/memory/memory-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders id/date/content columns in ${name} theme` | retain | rendering |
| "compresses content cleanly under a narrow terminal width" | retain | rendering |

### src/modules/module-manager/module-list-node.test.ts

Production owner: module-manager. Cadence: owner. Retained suite: [src/modules/module-manager/module-list-node.test.ts](../../../src/modules/module-manager/module-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders the modules table in ${name} theme` | retain | rendering |
| "compresses cleanly under a narrow terminal width" | retain | rendering |

### src/modules/owner-decisions/daemon-client.test.ts

Production owner: owner-decisions. Cadence: owner. Retained suite: [src/modules/owner-decisions/daemon-client.test.ts](../../../src/modules/owner-decisions/daemon-client.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "contributes the ownerDecisions namespace" | retain | owner behavior (outside CLI) |
| "uses owner-decision daemon-control routes" | retain | owner behavior (outside CLI) |

### src/modules/owner-questions/cli.test.ts

Production owner: owner-questions. Cadence: owner. Retained suite: [src/modules/owner-questions/cli.test.ts](../../../src/modules/owner-questions/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "list prints empty message when no pending questions" | replace/prune; see current owner scenarios | rendering |
| "list prints pending questions" | replace/prune; see current owner scenarios | rendering |
| "show prints full pending details without truncating context" | replace/prune; see current owner scenarios | rendering |
| "show and history render not-recorded metadata for legacy persisted questions" | replace/prune; see current owner scenarios | rendering |
| "count prints the pending count" | replace/prune; see current owner scenarios | rendering |
| "answer marks a pending question answered" | replace/prune; see current owner scenarios | rendering |
| "show prints resolved details and resolution source after answer" | replace/prune; see current owner scenarios | rendering |
| "answer errors on nonexistent id" | replace/prune; see current owner scenarios | rendering |
| "dismiss marks a pending question dismissed" | replace/prune; see current owner scenarios | rendering |
| "history shows resolved questions" | replace/prune; see current owner scenarios | rendering |
| "history --status filters" | replace/prune; see current owner scenarios | parsing |
| "prints empty wording and a machine-readable pending count" | retain rewritten CLI boundary | rendering |
| "lists the answer behavior and the detail command" | retain rewritten CLI boundary | rendering |
| "shows full context and workflow-resume instructions" | retain rewritten CLI boundary | rendering |
| "renders missing historical metadata explicitly" | retain rewritten CLI boundary | rendering |
| "forwards the answer as one argument and renders the response" | retain rewritten CLI boundary | parsing |
| "forwards --reason and renders a dismissal" | retain rewritten CLI boundary | parsing |
| "reports a missing answer target with exit status 1" | retain rewritten CLI boundary | exit-status |
| "filters history by status and retains resolved context and answer attribution" | retain rewritten CLI boundary | parsing |

### src/modules/recall/cli.test.ts

Production owner: recall. Cadence: owner. Retained suite: [src/modules/recall/cli.test.ts](../../../src/modules/recall/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints rendered hits with source, score, id, and title" | retain | rendering |
| "forwards --limit and --source into the recall filter" | retain | parsing |
| "forwards --min-score into the filter" | retain | parsing |
| "prints 'No matching hits.' when result is empty" | retain | rendering |
| "exits non-zero with a contributor message when the seam is unavailable" | retain | exit-status |

### src/modules/recall/render.test.ts

Production owner: recall. Cadence: owner. Retained suite: [src/modules/recall/render.test.ts](../../../src/modules/recall/render.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders every recall source arm from the shared golden fixture" | replace/prune; see current owner scenarios | rendering |
| "pins per-source descriptions and score precision through the fixture" | retain | rendering |

### src/modules/rendering/cli-transport.test.ts

Production owner: rendering. Cadence: owner. Retained suite: [src/modules/rendering/cli-transport.test.ts](../../../src/modules/rendering/cli-transport.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "routes streaming text events to stdout without a trailing newline" | retain | terminal |
| "routes status events to stderr as a rendered line" | retain | terminal |
| "routes streaming progress events to stderr raw" | retain | terminal |
| "shows thinking in verbose mode" | retain | rendering |
| "suppresses thinking in non-verbose mode" | retain | rendering |
| "emits thinking_start differently based on verbose" | retain | rendering |
| "formats cost events with per-turn and total when provided" | retain | rendering |
| "formats cost events with legacy summary fallback" | retain | rendering |
| "suppresses cost events when showCost is false" | retain | rendering |

### src/modules/rendering/render.test.ts

Production owner: rendering. Cadence: owner. Retained suite: [src/modules/rendering/render.test.ts](../../../src/modules/rendering/render.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "emits line text without ansi in no-color theme" | retain | terminal |
| "emits ansi codes in the default theme when spans carry a role" | retain | terminal |
| "renders a key-value block with aligned values" | retain | rendering |
| "renders status banner with icon + label + message" | retain | rendering |
| "renders ascii status icons under the ascii theme" | retain | rendering |
| "renders a nested stack with blanks and separators" | retain | rendering |
| "renders list with nested children indented" | retain | rendering |
| "renders panel with a box around body content" | retain | rendering |
| "renders panel title inline at the top border" | retain | rendering |
| "renders tool call with status icon and args" | retain | rendering |
| "renders agent message with role header" | retain | rendering |
| "renders diff with plus/minus prefixes preserved" | retain | rendering |
| "clamps width to a safe minimum to avoid negative divisions" | retain | rendering |
| "section rule renders label with a width-filling separator tail" | retain | rendering |
| `renders header + rows aligned and width-stable in ${name} theme` | retain | rendering |
| "compresses to a narrow terminal without overflowing the width" | retain | rendering |
| "right-aligned column pads on the left" | retain | rendering |
| `renders label + indented body in ${name} theme` | retain | rendering |
| `wraps to ctx.width in ${name} theme` | retain | rendering |
| "preserves paragraph breaks via blank lines" | retain | rendering |
| `renders sections separated by a blank line in ${name} theme` | retain | rendering |
| `emits a static frame for non-tick render in ${name} theme` | retain | rendering |
| `emits a tick-specific frame when tick is provided in ${name} theme` | retain | rendering |
| "emits the success status icon when status is success" | retain | rendering |
| `renders a width-aware bar with counter in ${name} theme` | retain | rendering |
| "uses success role when complete" | retain | rendering |

### src/modules/rendering/safe-terminal-text.test.ts

Production owner: rendering. Cadence: owner. Retained suite: [src/modules/rendering/safe-terminal-text.test.ts](../../../src/modules/rendering/safe-terminal-text.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "strips complete and unterminated terminal sequences plus formatting controls" | retain | rendering |
| "bounds repeated unterminated %s prefixes" | retain | rendering |

### src/modules/rendering/transport.test.ts

Production owner: rendering. Cadence: owner. Retained suite: [src/modules/rendering/transport.test.ts](../../../src/modules/rendering/transport.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "picks the default theme and declared columns on a real tty" | retain | terminal |
| "picks the no-color theme on a non-tty stream" | retain | terminal |
| "honors NO_COLOR even on a tty" | retain | terminal |
| "honors KOTA_RENDERER_THEME=ascii" | retain | rendering |
| "write appends a trailing newline to rendered output" | retain | rendering |
| "ansi span stays intact on tty, stripped on pipe" | retain | terminal |
| "getTerminalTransport returns a memoized shared instance" | replace/prune; see current owner scenarios | rendering |
| "renderToString uses the shared transport context by default" | retain | rendering |
| "raw machine-output helpers write through the shared stdout transport" | retain | rendering |
| "printToStderr writes through the shared stderr transport" | retain | terminal |
| "writeStderr forwards raw chunks through the shared stderr transport" | retain | terminal |
| "emits a single static frame on a non-tty stream" | retain | terminal |
| "does not emit any redraw chunks between updates on a non-tty stream" | retain | terminal |
| "redraws frames on an interactive tty and finalizes with the success icon" | retain | terminal |
| "clears the current spinner line when stopped on an interactive tty" | retain | terminal |
| "owns alternate-screen control for interactive streams" | retain | terminal |
| "skips alternate-screen control for non-tty streams" | retain | terminal |

### src/modules/repo-tasks/cli-move-security.test.ts

Production owner: repo-tasks. Cadence: owner. Retained suite: [src/modules/repo-tasks/cli-move-security.test.ts](../../../src/modules/repo-tasks/cli-move-security.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints a client error for invalid task ids without invoking git" | retain | parsing |

### src/modules/repo-tasks/cli.test.ts

Production owner: repo-tasks. Cadence: owner. Retained suite: [src/modules/repo-tasks/cli.test.ts](../../../src/modules/repo-tasks/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints 'No tasks found.' when queue is empty" | retain | rendering |
| "lists tasks from open states by default" | retain | rendering |
| "filters to specific state with --state" | retain | parsing |
| "prints full task content" | retain | rendering |
| "exits with error for unknown task" | retain | exit-status |
| "moves task file and updates status frontmatter" | replace/prune; see current owner scenarios | rendering |
| "prints message when task is already in target state" | retain | rendering |
| "creates a new inbox task file" | replace/prune; see current owner scenarios | rendering |
| "reports the created task ID" | retain | rendering |
| "errors if task file already exists" | retain | rendering |
| "falls back to keyword path with --keyword and prints matched ids" | retain | parsing |
| "exits non-zero with a single-line operator message when semantic is unavailable" | retain | exit-status |
| "emits structured payload with --json" | retain | parsing |
| "--json with semantic_unavailable exits non-zero but still emits the structured payload" | retain | exit-status |
| "filters by --state" | retain | parsing |
| "reports semantic reindex as unavailable when no capability is configured" | retain | rendering |
| "prints success counts when reindex completes" | retain | rendering |
| "exits non-zero when reindex reports failures" | retain | exit-status |
| `renders the ${name} theme without overflowing a wide terminal` | retain | rendering |
| `compresses Title cleanly under a narrow width in ${name} theme` | retain | rendering |
| "declares ID/Pri/State/Title columns with Title carrying maxWidth" | replace/prune; see current owner scenarios | rendering |

### src/modules/repo-tasks/daemon-client-move-security.test.ts

Production owner: repo-tasks. Cadence: owner. Retained suite: [src/modules/repo-tasks/daemon-client-move-security.test.ts](../../../src/modules/repo-tasks/daemon-client-move-security.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "decodes typed invalid-id 400 responses" | retain | owner behavior (outside CLI) |

### src/modules/resource-discovery/cli.test.ts

Production owner: resource-discovery. Cadence: owner. Retained suite: [src/modules/resource-discovery/cli.test.ts](../../../src/modules/resource-discovery/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints the structured provider envelope for --json" | retain | parsing |
| "falls back to the local provider when a stale daemon lacks the route" | retain | rendering |

### src/modules/secrets/prompt.test.ts

Production owner: secrets. Cadence: owner. Retained suite: [src/modules/secrets/prompt.test.ts](../../../src/modules/secrets/prompt.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "uses raw TTY input without echoing the typed secret" | retain | terminal |
| "keeps non-TTY stdin compatible for piped input" | retain | terminal |

### src/modules/setup/index.test.ts

Production owner: setup. Cadence: owner. Retained suite: [src/modules/setup/index.test.ts](../../../src/modules/setup/index.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "resolves setup status inputs through manifest setup links" | retain | rendering |
| "fails when a manifest setup link has no source declaration" | retain | rendering |
| "renders stable credential metadata from the typed client projection" | retain | rendering |
| "renders the secret input contract for a pending completion action" | retain | terminal |
| "reads secret values from stdin without putting them in argv or output" | retain | terminal |
| "redacts submitted stdin secrets from JSON results" | retain | terminal |
| "does not expose the removed raw argv option in help" | retain | parsing |
| "rejects the removed raw argv option without forwarding the secret" | retain | parsing |
| "reads completion secret values from stdin while preserving non-sensitive argv values" | retain | terminal |
| "does not expose the removed completion raw argv option in help" | retain | parsing |

### src/modules/setup/scope-client.test.ts

Production owner: setup. Cadence: owner. Retained suite: [src/modules/setup/scope-client.test.ts](../../../src/modules/setup/scope-client.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "reads and mutates setup state in the selected directory scope" | retain | owner behavior (outside CLI) |
| "keeps unscoped daemon setup calls compatible and rejects scoped ones" | retain | owner behavior (outside CLI) |

### src/modules/setup/ui-surface.test.ts

Production owner: setup. Cadence: owner. Retained suite: [src/modules/setup/ui-surface.test.ts](../../../src/modules/setup/ui-surface.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "builds form, secret, URL, refresh, and revoke actions" | retain | owner behavior (outside CLI) |
| "builds executable actions from preserved credential identifiers" | retain | owner behavior (outside CLI) |

### src/modules/skill-ops/skill-list-node.test.ts

Production owner: skill-ops. Cadence: owner. Retained suite: [src/modules/skill-ops/skill-list-node.test.ts](../../../src/modules/skill-ops/skill-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders the skill table in ${name} theme` | retain | rendering |

### src/modules/voice/cli.test.ts

Production owner: voice. Cadence: owner. Retained suite: [src/modules/voice/cli.test.ts](../../../src/modules/voice/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "transcribes through the namespace and prints the text" | retain | rendering |
| "surfaces daemon_required as the daemon-not-running hint" | retain | rendering |
| "surfaces a non-ok daemon response as a CLI failure with code" | retain | rendering |
| "writes synthesized audio to the --output path" | retain | parsing |
| "surfaces synthesize daemon_required cleanly" | retain | rendering |

### src/modules/webhook/cli.test.ts

Production owner: webhook. Cadence: owner. Retained suite: [src/modules/webhook/cli.test.ts](../../../src/modules/webhook/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "shows webhook-triggered workflows with no-secret status" | retain | rendering |
| "does not list workflows without webhook triggers" | replace/prune; see current owner scenarios | rendering |
| "shows configured status when a secret exists in config" | retain | rendering |
| "never prints secret values" | retain | rendering |
| "generates a 64-char hex secret and writes it to .kota/config.json" | replace/prune; see current owner scenarios | rendering |
| "prints the generated secret once" | retain | rendering |
| "prints timestamp-bound signing guidance" | retain | rendering |
| "warns when overwriting an existing secret" | retain | rendering |
| "does not warn for a new workflow with no prior secret" | retain | rendering |
| "preserves other config fields when writing" | replace/prune; see current owner scenarios | rendering |
| "removes webhook entry from config" | replace/prune; see current owner scenarios | rendering |
| "removes webhooks key entirely when last entry is deleted" | replace/prune; see current owner scenarios | rendering |
| "prints 'No webhook secret configured' when workflow not found" | retain | rendering |
| "prints the removed workflow confirmation" | retain rewritten CLI boundary | confirmation |

### src/modules/workflow-ops/dead-letter-local-client.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/dead-letter-local-client.test.ts](../../../src/modules/workflow-ops/dead-letter-local-client.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "lists, exports, and mutates without runtime event authority" | retain | owner behavior (outside CLI) |
| "requires the daemon for original redrive admission" | retain | owner behavior (outside CLI) |

### src/modules/workflow-ops/definitions/definition-log.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/definitions/definition-log.test.ts](../../../src/modules/workflow-ops/definitions/definition-log.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "uses bounded git argv calls and keeps the definition path in one argument" | retain | parsing |

### src/modules/workflow-ops/definitions/explain.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/definitions/explain.test.ts](../../../src/modules/workflow-ops/definitions/explain.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders a channel-style explain result as text" | retain | rendering |
| "renders a code-hook-style explain result as JSON" | retain | rendering |

### src/modules/workflow-ops/execution/dry-run.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/execution/dry-run.test.ts](../../../src/modules/workflow-ops/execution/dry-run.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "prints the run plan without creating run artifacts, emitting bus events, or executing steps" | retain | rendering |
| "returns step plan with no-condition for steps without when" | retain | owner behavior (outside CLI) |
| "marks steps skipped when when predicate returns false with empty context" | retain | owner behavior (outside CLI) |
| "marks steps as runs when when predicate returns true with empty context" | retain | owner behavior (outside CLI) |
| "marks steps error when when predicate throws" | retain | owner behavior (outside CLI) |
| "rejects command execution from dry-run predicates explicitly" | retain | owner behavior (outside CLI) |
| "marks step skipped when when predicate accesses empty stepOutputs" | retain | owner behavior (outside CLI) |
| "includes children for parallel steps" | retain | owner behavior (outside CLI) |
| "shows correct config for agent step" | retain | owner behavior (outside CLI) |
| "shows correct config for tool step" | retain | owner behavior (outside CLI) |
| "shows retry info in tool step config" | retain | owner behavior (outside CLI) |
| "shows correct config for emit step" | retain | owner behavior (outside CLI) |
| "shows correct config for restart step" | retain | owner behavior (outside CLI) |
| "passes when all tools are available" | retain | owner behavior (outside CLI) |
| "fails when a tool step references a missing tool" | retain | owner behavior (outside CLI) |
| "checks tool availability in nested parallel steps" | retain | owner behavior (outside CLI) |
| "matches trigger against provided payload" | retain | owner behavior (outside CLI) |
| "resolves registered event schema refs for trigger match and step context" | retain | owner behavior (outside CLI) |
| "replays a durable event envelope through trigger matching and step context" | retain | owner behavior (outside CLI) |
| "replays workflow batch flush envelopes through matching batch triggers" | retain | owner behavior (outside CLI) |
| "fails when a matched registered event payload violates its schema" | retain | owner behavior (outside CLI) |
| "fails when no trigger matches the provided payload" | retain | owner behavior (outside CLI) |
| "reports multiple diagnostics for several missing tools" | retain | rendering |
| "passes with no options (backward compatible)" | retain | owner behavior (outside CLI) |
| "includes workflow name, definition path, and step count" | retain | rendering |
| "notes when predicate returning false as would-skip" | retain | rendering |
| "notes when predicate returning true as runs" | retain | rendering |
| "notes when predicate error with message" | retain | rendering |
| "counts parallel children in total step count" | retain | owner behavior (outside CLI) |
| "shows no condition annotation for steps without when" | retain | rendering |
| "shows PASS for valid workflow" | retain | rendering |
| "shows FAIL with diagnostics for missing tool" | retain | rendering |
| "shows trigger match info" | retain | rendering |

### src/modules/workflow-ops/execution/exec.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/execution/exec.test.ts](../../../src/modules/workflow-ops/execution/exec.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "forces harness, model, and effort while removing tier routing" | retain | owner behavior (outside CLI) |
| "does not classify an ordinary checkout as an isolated eval root" | retain | owner behavior (outside CLI) |
| "recognizes the eval harness isolated root from its existing runtime facts" | retain | owner behavior (outside CLI) |
| "routes a canonical execution through the scoped daemon client and waits for terminal status" | retain | rendering |
| "fails closed when no daemon-owned canonical runtime is available" | retain | owner behavior (outside CLI) |
| "reports the missing daemon override API instead of executing canonically" | retain | rendering |

### src/modules/workflow-ops/execution/trial.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/execution/trial.test.ts](../../../src/modules/workflow-ops/execution/trial.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "runs in an isolated scope and reports changed files, steps, and bus events" | retain | owner behavior (outside CLI) |
| "scopes sensitive trial report payloads, bus events, and queued workflows" | retain | owner behavior (outside CLI) |
| "roots local filesystem tool steps inside the isolated scope copy" | retain | owner behavior (outside CLI) |
| "blocks explicit external side-effect tool steps before execution" | retain | owner behavior (outside CLI) |
| "blocks tool side effects from the module manifest projection before registry metadata" | retain | owner behavior (outside CLI) |
| "blocks daemon-state and unscoped local write tool steps before execution" | retain | owner behavior (outside CLI) |
| "blocks process-env tool steps before they can mutate the daemon environment" | retain | owner behavior (outside CLI) |
| "blocks shell tool steps instead of treating cwd rewriting as isolation" | retain | owner behavior (outside CLI) |
| "executes the runtime and skips unreachable dangerous tool declarations" | retain | owner behavior (outside CLI) |
| "records every blocked runtime ctx.runTool side effect even when code catches the errors" | retain | owner behavior (outside CLI) |
| "blocks KOTA-controlled agent process-env tools before adapter execution" | retain | owner behavior (outside CLI) |
| "blocks KOTA-controlled agent tool side effects before adapter execution" | retain | owner behavior (outside CLI) |
| "records repeat attempts and comparison variants in one summary" | retain | owner behavior (outside CLI) |
| "runs a local trial against the requested configured scope id" | retain | owner behavior (outside CLI) |
| "default runtime factory preserves workflow inputs and registered agent resolution" | retain | owner behavior (outside CLI) |
| "rejects an unknown requested scope id before trial execution" | retain | owner behavior (outside CLI) |
| "CLI uses the daemon workflow client when the daemon handles trial execution" | retain | rendering |
| "CLI falls back to the local isolated-project runner when the daemon is unavailable" | retain | rendering |

### src/modules/workflow-ops/execution/trigger-authority.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/execution/trigger-authority.test.ts](../../../src/modules/workflow-ops/execution/trigger-authority.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "preserves the canonical diagnostic from retry prefix lookup" | retain | rendering |

### src/modules/workflow-ops/index.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/index.test.ts](../../../src/modules/workflow-ops/index.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "exposes automation as an alias for the workflow command" | retain | parsing |

### src/modules/workflow-ops/runs/authority-errors.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/authority-errors.test.ts](../../../src/modules/workflow-ops/runs/authority-errors.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "preserves the canonical diagnostic from $name prefix lookup" | retain | rendering |

### src/modules/workflow-ops/runs/follow.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/follow.test.ts](../../../src/modules/workflow-ops/runs/follow.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "fails before opening SSE when daemon status identifies an active run without metadata" | retain | rendering |
| "accepts terminal evidence retained only for pending publication" | retain | rendering |
| "accepts finalized execution evidence selected from daemon active status" | retain | parsing |
| "accepts finalized execution evidence while offline SQLite authority owns the run" | retain | rendering |
| "refuses to follow when daemon status omits durable authority" | retain | rendering |

### src/modules/workflow-ops/runs/run-cost-node.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/run-cost-node.test.ts](../../../src/modules/workflow-ops/runs/run-cost-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders the per-workflow cost table in ${name} theme` | retain | rendering |
| "returns null when given an empty rows array" | retain | rendering |
| "renders absent measurements as unknown rather than zero" | retain | rendering |
| "renders one row per finished run" | retain | rendering |
| "falls back to a no-runs message when nothing finished" | retain | rendering |

### src/modules/workflow-ops/runs/run-diff.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/run-diff.test.ts](../../../src/modules/workflow-ops/runs/run-diff.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "produces one entry per step when steps match" | retain | rendering |
| "shows null statusB for steps only in A" | retain | rendering |
| "shows null statusA for steps only in B" | retain | rendering |
| "extracts measured cost from step usage" | retain | rendering |
| "returns null cost when step usage has no measured cost" | retain | rendering |
| "fits in 80 columns when there is no cost" | retain | rendering |
| "includes run IDs in the header lines" | retain | rendering |
| "shows N/A for steps only in one run" | retain | rendering |
| "shows cost columns when any step has cost" | retain | rendering |
| "omits cost columns when no step has cost" | retain | rendering |
| "shows regressed status as status-a arrow status-b" | retain | rendering |

### src/modules/workflow-ops/runs/run-list-node.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/run-list-node.test.ts](../../../src/modules/workflow-ops/runs/run-list-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders id/workflow/status/cost columns in ${name} theme at wide width` | retain | rendering |
| `fits within a narrow terminal width in ${name} theme` | retain | rendering |
| "renders workflow / runs / cost / duration columns" | retain | rendering |

### src/modules/workflow-ops/runs/run-show.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/run-show.test.ts](../../../src/modules/workflow-ops/runs/run-show.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "formats a single warning" | retain | rendering |
| "formats multiple warnings" | retain | rendering |
| "returns empty array for no warnings" | retain | rendering |
| "returns null for null output" | retain | rendering |
| "returns null when repairIterations is absent" | retain | rendering |
| "returns null when repairIterations is empty" | retain | rendering |
| "returns summary for a single repair iteration" | retain | rendering |
| "returns summary for multiple repair iterations" | retain | rendering |
| "handles iteration with no failures (all passed in last repair)" | retain | rendering |
| "formats a single repair" | retain | rendering |
| "formats multiple repairs" | retain | rendering |
| "does not include compatibility cost output" | retain | rendering |
| "shows 'passed' when iteration had no failures" | retain | rendering |
| "renders a single root node marked as current" | retain | rendering |
| "renders parent and child with correct connectors" | retain | rendering |
| "uses ├─ for non-last children and └─ for last" | retain | rendering |
| "marks no node as current when currentId does not match" | retain | rendering |
| "indents nested grandchildren under the group primitive" | retain | rendering |
| `renders chain tree in ${name} theme without overflowing width` | retain | rendering |

### src/modules/workflow-ops/runs/run-stats-node.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/run-stats-node.test.ts](../../../src/modules/workflow-ops/runs/run-stats-node.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| `renders headings + per-workflow rows in ${name} theme at wide width` | retain | rendering |
| "compresses cleanly in a narrow terminal width" | retain | rendering |

### src/modules/workflow-ops/runs/step-inspect.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/runs/step-inspect.test.ts](../../../src/modules/workflow-ops/runs/step-inspect.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "renders agent step summary" | retain | rendering |
| "surfaces the resolved harness and model on agent steps" | retain | rendering |
| "renders code step summary" | retain | rendering |
| "shows error when step failed" | retain | rendering |
| "reads the step admitted by canonical run metadata" | retain | rendering |
| "reports a missing step from canonical run metadata" | retain | rendering |
| "does not treat an artifact-only directory as a run" | retain | rendering |
| "fails closed when authority-critical run metadata is malformed" | retain | rendering |

### src/modules/workflow-ops/simulation/cli.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/simulation/cli.test.ts](../../../src/modules/workflow-ops/simulation/cli.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "passes synthetic event input through the workflow client and renders text" | retain | rendering |
| "loads committed fixtures and can list them" | retain | rendering |

### src/modules/workflow-ops/ui-surface.test.ts

Production owner: workflow-ops. Cadence: owner. Retained suite: [src/modules/workflow-ops/ui-surface.test.ts](../../../src/modules/workflow-ops/ui-surface.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "strips terminal controls from approval and owner-question rows" | retain | owner behavior (outside CLI) |
| "bounds repeated unterminated OSC prefixes in approval and owner-question rows" | retain | owner behavior (outside CLI) |
| "builds executable queued and recent run supervision controls" | retain | owner behavior (outside CLI) |

### src/scope-onboarding-cli.integration.test.ts

Production owner: daemon-ops / scope authority. Cadence: integration. Retained suite: [src/scope-onboarding-cli.integration.test.ts](../../../src/scope-onboarding-cli.integration.test.ts).

| Scenario / observable oracle | Disposition | Distinct failure category |
| --- | --- | --- |
| "onboards idempotently and re-registers a removed scope without data loss" | retain | rendering |

## Prior rendered approval evidence

This recorded child-process transcript exercises the built approval Commander command against authored responses. It proves presentation, redaction and process exit status; it does not claim that a real approval executed a tool.

```text
Built approval command rendering probe. Authored client responses; no tools executed and no queue mutated.

$ kota approval approve-all --yes
[client response: succeeded]
stdout:
1 pending approval(s) to be approved:

  [1234abcd] shell  (0m ago)
    Input:  {"command":"publish reviewed change","accessToken":"[redacted]"}
    Digest: bef21ecd4cb2f43f082e88ffe586f6cbcdf270596b8c663a19494d73c4fc7511
    Risk:   dangerous
    Reason: reviewed operation

Approved and executed shell [1234abcd] — output redacted by daemon policy (42 bytes).

Done: 1 approved, 0 failed.
stderr:
exit status: 0

$ kota approval approve-all --yes
[client response: gate]
stdout:
1 pending approval(s) to be approved:

  [1234abcd] shell  (0m ago)
    Input:  {"command":"publish reviewed change","accessToken":"[redacted]"}
    Digest: bef21ecd4cb2f43f082e88ffe586f6cbcdf270596b8c663a19494d73c4fc7511
    Risk:   dangerous
    Reason: reviewed operation

Approved workflow gate shell [1234abcd]

Done: 1 approved, 0 failed.
stderr:
exit status: 0

$ kota approval approve-all --yes
[client response: failed]
stdout:
1 pending approval(s) to be approved:

  [1234abcd] shell  (0m ago)
    Input:  {"command":"publish reviewed change","accessToken":"[redacted]"}
    Digest: bef21ecd4cb2f43f082e88ffe586f6cbcdf270596b8c663a19494d73c4fc7511
    Risk:   dangerous
    Reason: reviewed operation


Done: 0 approved, 1 failed.
stderr:
Tool execution failed in daemon for [1234abcd] shell — output redacted by daemon policy (42 bytes).
exit status: 1

```