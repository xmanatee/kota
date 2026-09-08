---
status: done
---

# Migrate autonomy workflow verification families

## Scope / Starting Points

Inventory every workflow below `src/modules/autonomy/workflows`, grouped at minimum into build/review/decompose/improve, queue/promotion/intake, health/monitor/calibration, research/retry/explore, and digest/notification families.

## Required Changes

- Migrate each family to the core runtime and extracted decision owners.
- Retain workflow observations only for semantic routing, resources, authorization, agent output schema, published outcome, and distinct recovery/integration behavior.
- Remove private phase, helper-order, command-call, prompt-string, evidence-filename, source-absence, and copied lifecycle assertions.
- Delete obsolete fixture builders and global reset/setup infrastructure as final consumers disappear.

## Must Not Complete While

Any workflow family or fixture is unclassified, any core lifecycle matrix remains copied, or deterministic behavior is moved into eval fixtures.

## Done When

Every workflow family has zero unresolved inventory rows and each retained scenario names a workflow-specific failure beyond core runtime and decision owners.

## Acceptance Evidence

Provide the workflow-family/scenario/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-simplify-workflow-and-autonomy-tests`.

## Completion evidence

The following historical acceptance record is embedded here so review does not
require access to the isolated agent directory. It covers all 29 workflow
definitions, all 439 baseline scenario templates, and all 13 final authored
support files across the five requested families. No classifications are
unresolved. Production sources and prompts are unchanged; no deterministic
behavior moved into eval fixtures.

The recent-owner-marker workflow scenario retains an observable routing oracle:
queue processing must succeed and emit no blocked owner-decision request. This
catches a workflow that ignores the blocker owner's recent-ask decision when
publishing follow-ups. The existing due-marker scenario observes the positive
request path through the actual owner-decision workflow.

### Validation and limits

Earlier build-run evidence records 441 passing owner checks across 69 files,
followed by passing focused cleanup selections of 53, 65, and 1 checks; 440
non-route checks remain after fixture-only removal. Production/test typechecks,
scoped Biome, diff hygiene, and task validation passed in that build attempt.
These are prior-run results, not fresh repair execution claims.

During this repair, every baseline file's line count was checked against Git,
every final inventory path/count against the worktree, all 174 production files
were byte-compared with the baseline, and the disposition rows were reconciled
against all baseline scenario names and the union of support files. Support
consumers were resolved by import path to avoid conflating same-named helpers.
Scoped `git diff --check` passed. Direct inspection confirms the repaired test
fails for either an unsuccessful run or any duplicate request event.

Fresh `pnpm test:owner src/modules/autonomy/workflows/blocked-promoter/workflow.test.ts`
could not start because this repair session has no installed Vitest. Offline
restoration was rejected when writing the sandbox's read-only `node_modules`.
The same missing dependencies prevent fresh TypeScript/task-validator execution.
The earlier run also excluded eight HTTP checks in two digest route suites
because loopback listeners failed with EPERM. Git-backed scenarios used actual
Git through a controlled launcher because process supervision could not run
`/bin/ps`. These execution limits do not imply passing results.

### Counting provenance

Baseline: commit `9e88503eadd9f37db14c31441708df82f20540c1`; after: this repaired isolated change set.

Counts include physical lines, blanks and comments, for all `.ts` and `.json`
files recursively below `src/modules/autonomy/workflows`. `.test.ts` and
`.test-cases.ts` are executable tests. Files matching `test-support`,
`test-context`, `test-helpers`, `test-fixture`, `test.helpers`, or `__fixtures__`
are authored support; the remaining files are production. Markdown is excluded.
The per-file ledger below makes the totals independently reproducible with
`git show <baseline>:<path>` and the final file contents. Scenario rows are source
templates, including parameterized cases; they are not a claim about test counts.

### Autonomy workflow verification disposition

Scope: all 29 workflow definitions under `src/modules/autonomy/workflows`, every executable scenario source and authored support file in that subtree. Scenario rows include parameterized templates; their inputs remain in the linked source. All retained checks run in the owner portfolio, including direct decision-owner tests. No deterministic case moved into eval.

Core remains the sole owner of lifecycle, resource allocation, process supervision, generic output correction, wait/resume, validation, and serialized integration. Retained workflow cases prove semantic wiring or the domain invariant handed to those rails. Literal prompt checks were deleted, not relabeled as model-quality proof.

### Workflow-family matrix

| Family | Workflow | Decision/production owner | Public stimulus | Distinct failure / retained seam | Disposition |
| --- | --- | --- | --- | --- | --- |
| digest/notification | attention-digest | Attention detector, blocker policy and cadence/on-demand projection | attention event / on-demand CLI or route | Warnings/blockers are omitted or over-reported, cadence advances on reads, or an operator pull sends duplicate notifications. | Retain semantic observations; core executor and typed owners own mechanics. |
| health/monitor/calibration | autonomy-health-reviewer | Health signal grouping, issue projection and generated-work lifecycle | autonomy health signals | Repeated observations churn tasks/questions, evidence is incorrectly grouped, terminal tasks reopen, or cleared issues retain obsolete work. | Retain semantic observations; core executor and typed owners own mechanics. |
| health/monitor/calibration | autonomy-issue-projection-materialization | Typed issue projection/state publication owner | staged projection materialization request | A requested unpublished revision is materialized or JSON becomes authority instead of a projection of runtime state. | Retain existing owner/composition proof outside this subtree and inspect typed workflow consumer; no new duplicate scenario. |
| queue/promotion/intake | blocked-promoter | Blocker policy, promotion and owner-answer authorization | queue shape / blocked owner resolution | Unsatisfied capture/dependency evidence promotes a task, ambiguous answers authorize it, or changed blockers accept stale owner decisions. | Retain semantic observations; core executor and typed owners own mechanics. |
| queue/promotion/intake | blocked-promoter-owner-decision | Core askOwnerSteps and OwnerQuestionQueue; blocker authorization | staged blocked owner request | The actual displayed answers/recommendation fail to reach the owner or a persisted ambiguous answer grants task promotion. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | builder | Builder task contract; repo-tasks dispatch owner | autonomy.queue.available | A stale or nonterminal target is built/published, or calibration reads the wrong critic evidence. | Retain semantic observations; core executor and typed owners own mechanics. |
| digest/notification | daily-digest | Daily aggregation/rendering and cadence snapshot owner | scheduled digest / on-demand CLI or route | Delivered work is misreported, the queue delta uses the wrong baseline, scope questions leak, or on-demand reads mutate cadence state. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | decomposer | Failed-run assessment, decomposition plan/actions/check | failed builder completion | An unauthenticated, superseded, or rejected parent plan creates subtasks; approved decomposition fails to archive the exact parent. | Retain semantic observations; core executor and typed owners own mechanics. |
| queue/promotion/intake | dispatcher | Queue policy, repo-tasks eligibility and semantic reflection owners | runtime.idle; typed review requests | Queue shape dispatches the wrong task/research/security event, bypasses authority/dependencies, or conflates lossless explicit and latest automatic requests. | Retain semantic observations; core executor and typed owners own mechanics. |
| health/monitor/calibration | evaluator-calibration-monitor | Evaluator calibration aggregate/gate and health-signal projection | completed builder run | Contradictions fail to reach the health reviewer or healthy/insufficient samples create regression work. | Retain semantic observations; core executor and typed owners own mechanics. |
| digest/notification | evaluator-calibration-notify | Calibration attention projection | evaluator-calibration.regression.detected | A measured contradiction loses its rate/reason when delivered as operator attention. | Retain semantic observations; core executor and typed owners own mechanics. |
| research/retry/explore | explorer | Explorer assessment, watchlist and publication owners | autonomy.queue.empty / autonomy.queue.thin | Skipped exploration advances cooldown, thin work starves discovery, or accessible/redirected sources corrupt the watchlist. | Retain semantic observations; core executor and typed owners own mechanics. |
| research/retry/explore | explorer-publication | Explorer publication owner and runtime transactional state | staged exploration publication request | The isolated writer advances canonical cooldown before successful integration. | Retain semantic observations; core executor and typed owners own mechanics. |
| queue/promotion/intake | github-mention-intake | Mention assessment and safe task content owners | routed implementation mention | Vague/hostile/low-trust mentions create tasks, source delimiters escape the task boundary, or task references publish before integration. | Retain semantic observations; core executor and typed owners own mechanics. |
| digest/notification | github-mention-responder | Mention authorization and comment-output decoder | routed response / integrated intake comment | Untrusted or implementation-only mentions invoke response writes, secrets persist, or an approved response targets the wrong issue. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | improver | Issue selection, disposition, recovery and publication owners | autonomy issue decision request | An issue revision is reviewed twice, an obsolete fingerprint publishes effects, or unverified recovery clears an issue. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | improver-disposition-publication | Improver disposition publication owner | staged issue disposition request | The issue fingerprint or health contract changes between writer output and owner-effect publication. | Retain semantic observations; core executor and typed owners own mechanics. |
| queue/promotion/intake | inbox-sorter | Inbox inspection and task validation consumers | autonomy.inbox.available | Empty inboxes launch sorting, unrelated changes are admitted, or populated captures fail to reach the sorter. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | pr-reviewer | PR assessment and GitHub comment policy | github.pull_request | Untrusted PRs or invalid/secret-bearing reviews reach a GitHub write, or approved review loses its target/recommendation. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | progress-review-publication | Progress semantic publication owner | staged progress publication request | Integrated task retirement loses paired owner effects or a stale review overwrites newer semantic consumption. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | progress-reviewer | Progress evidence collectors, citation decoder, action and semantic publication owners | explicit/automatic progress request; direct evidence/action API | Review acts on unknown/forged/cross-scope evidence, loses canonical context, repeats a consumed request, or publishes superseded task/question effects. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | repo-ai-checks | Trusted-base check discovery and workflow result decoder | github.pull_request | Head-authored instructions replace trusted checks, malformed findings publish, or authorization gates fail to control the advisory comment. | Retain semantic observations; core executor and typed owners own mechanics. |
| research/retry/explore | research-retry | Research trigger, candidate precondition and attempt-marker owners | autonomy.blocked-research.attemptable | Missing capabilities or unchanged fingerprints relaunch work, the wrong stable candidate is selected, or terminal tasks receive new retry markers. | Retain semantic observations; core executor and typed owners own mechanics. |
| health/monitor/calibration | runtime-health-auditor | Runtime audit evidence and control coverage projection owners | scheduled runtime audit; direct audit API | Transport/provider incidents become local repairs, forged/stale gate evidence counts as coverage, or active/recovered runtime evidence is misattributed. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | scope-improvement-actions | Scope improvement action and authority owners | delegated scope action request | A writer uses the reviewer’s old authority instead of rechecking current task-write policy. | Retain semantic observations; core executor and typed owners own mechanics. |
| queue/promotion/intake | scope-improvement-onboarding | Scope lifecycle admission and semantic reservation owner | scope.lifecycle.changed | A foreign, unauthenticated, or already consumed onboarding event reserves another scope review. | Retain existing owner/composition proof outside this subtree and inspect typed workflow consumer; no new duplicate scenario. |
| build/review/decompose/improve | scope-improvement-publication | Scope improvement publication owner | staged scope publication request | Semantic freshness incorrectly discards integrated paired effects or permits an obsolete question/task transition. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | scope-improver | Scope authority, fingerprint, recommendation and consumption owners | explicit/automatic scope improvement request | Live scope policy fails to downgrade task proposals, stale guidance is acted on, or delayed publication undoes a newer disposition. | Retain semantic observations; core executor and typed owners own mechanics. |
| build/review/decompose/improve | security-review | Security due/scanner/candidate/finding/task-identity owners | due/manual security review; direct scan/decoder/task APIs | Unchanged security evidence repeats review, due targets are starved, unconfirmed findings create tasks, or stable finding identity loses provenance. | Retain semantic observations; core executor and typed owners own mechanics. |

Auxiliary consumers: onboarding is exercised by `scope-improver/semantic-request.test.ts` and `src/scope-onboarding-e2e.integration.test.ts`; issue materialization is covered by `src/modules/autonomy/autonomy-issue-projection.test.ts` and issue lifecycle/reconciliation integration tests. Publication follow-ups are observed by the corresponding parent owner publication suites and resource-binding scenario. Those existing outside-subtree suites were inspected for ownership, not rerun or counted in this task.

### Exhaustive scenario matrix

The named scenario is the specific regression boundary within its family above. Direct decision API cases stay at their owner; workflow cases retain only routing, resource/authorization, schema, domain evidence, task/question outcomes, and domain publication invariants. A retained scenario may have fewer assertions: private code-step success/skip lists, helper-order, command-spelling, prompt-text and filename assertions were removed.

| Source | Scenario / distinct boundary | Disposition |
| --- | --- | --- |
| `attention-digest/attention-cli.test.ts` | prints the same body renderOnDemandAttention produces when items exist | Retain at semantic owner |
| `attention-digest/attention-cli.test.ts` | prints the no-items reply when nothing warrants attention | Retain at semantic owner |
| `attention-digest/attention-cli.test.ts` | --json emits the structured AttentionItem[] payload and rendered text | Retain at semantic owner |
| `attention-digest/attention-route.test.ts` | returns the same body and structured payload renderOnDemandAttention produces | Retain at semantic owner |
| `attention-digest/attention-route.test.ts` | does not emit workflow.attention.digest | Retain at semantic owner |
| `attention-digest/attention-route.test.ts` | rejects requests without the bearer token | Retain at semantic owner |
| `attention-digest/attention-route.test.ts` | accepts the token via the query parameter as well | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not emit before 10 invocations | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not emit at 10 invocations when nothing warrants attention | Retain at semantic owner |
| `attention-digest/step.test.ts` | surfaces a durable exhausted-investigation attention disposition | Retain at semantic owner |
| `attention-digest/step.test.ts` | emits workflow.attention.digest at exactly 10 invocations when builder failure streak >= 3 | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not emit at 10 invocations when builder failures < 3 | Retain at semantic owner |
| `attention-digest/step.test.ts` | emits digest when multiple tasks are blocked | Retain at semantic owner |
| `attention-digest/step.test.ts` | emits digest when the open task queue is empty | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not emit when the open queue is populated and nothing else warrants attention | Retain at semantic owner |
| `attention-digest/step.test.ts` | includes multiple attention items in one digest | Retain at semantic owner |
| `attention-digest/step.test.ts` | emits digest every 10 invocations, not just once | Retain at semantic owner |
| `attention-digest/step.test.ts` | digest text starts with attention digest header | Retain at semantic owner |
| `attention-digest/step.test.ts` | emits digest without emit callback (no-op, no throw) | Retain at semantic owner |
| `attention-digest/step.test.ts` | lists all run dirs to verify test isolation | Delete fixture self-test; no production stimulus or distinct consumer failure |
| `attention-digest/step.test.ts` | emits digest when N builder runs have completed-with-warnings (default N=3, M=10) | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not emit when fewer than N builder runs have warnings | Retain at semantic owner |
| `attention-digest/step.test.ts` | respects custom N and M env vars | Retain at semantic owner |
| `attention-digest/step.test.ts` | includes warning type in detail when all warnings share the same type | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not include type in detail when warnings have mixed types | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not count non-builder warning runs | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not surface a task that has not reached the threshold | Retain at semantic owner |
| `attention-digest/step.test.ts` | surfaces a task sitting exactly at the threshold | Retain at semantic owner |
| `attention-digest/step.test.ts` | surfaces a task one day past the threshold | Retain at semantic owner |
| `attention-digest/step.test.ts` | labels an owner-blocker task differently from a stale blocker | Retain at semantic owner |
| `attention-digest/step.test.ts` | suppresses the aggregate line when every blocked task is long-blocked | Retain at semantic owner |
| `attention-digest/step.test.ts` | caps individual items at five and summarizes the tail | Retain at semantic owner |
| `attention-digest/step.test.ts` | respects KOTA_DIGEST_BLOCKED_AGE_DAYS override | Retain at semantic owner |
| `attention-digest/step.test.ts` | fails closed against a centralized active-run authority | Delete vacuous digest case: successful run never entered warning detector; canonical run-reader and progress-evidence owners retain authority proof |
| `attention-digest/step.test.ts` | returns the same body cadence would emit when items exist | Retain at semantic owner |
| `attention-digest/step.test.ts` | returns the short fixed reply when nothing warrants attention | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not depend on cadence state | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not emit workflow.attention.digest | Retain at semantic owner |
| `attention-digest/step.test.ts` | suppresses an aged owner-decision when a fresh ask marker is on the body | Retain at semantic owner |
| `attention-digest/step.test.ts` | suppresses an aged operator-capture when a fresh instructed marker is on the body | Retain at semantic owner |
| `attention-digest/step.test.ts` | surfaces an aged operator-capture again once the marker ages past 14 days | Retain at semantic owner |
| `attention-digest/step.test.ts` | surfaces an aged owner-decision precondition past 14 days | Retain at semantic owner |
| `attention-digest/step.test.ts` | does not surface an operator-capture precondition under the threshold | Retain at semantic owner |
| `attention-digest/workflow.test.ts` | registers without errors | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `autonomy-health-reviewer/health-review-dedupe.test.ts` | tracks distinct shared-evidence groups without replay churn | Retain at semantic owner |
| `autonomy-health-reviewer/health-review-terminal-task.test.ts` | leaves completed tasks untouched when an issue recurs | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | keeps one warning ephemeral and admits the repeated observation | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | requests one issue decision without writing tasks or owner questions | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | enriches repeated evidence without another decision or attention item | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | plans linked question dismissal without mutating before commit | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | drops the stable generated task on an explicit source clear | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | retires a generated question once and renews it when the same issue returns | Retain at semantic owner |
| `autonomy-health-reviewer/health-review.test.ts` | persists bounded projected evidence instead of raw runtime text | Retain at semantic owner |
| `autonomy-health-reviewer/workflow.test.ts` | keeps health inspection read-only and delegates task writes | Retain at semantic owner |
| `autonomy-health-reviewer/workflow.test.ts` | commits the issue transition and follow-up effects in the reviewer run | Retain at semantic owner |
| `autonomy-health-reviewer/workflow.test.ts` | keeps runtime audit step output below the workflow output cap | Retain at semantic owner |
| `autonomy-health-reviewer/workflow.test.ts` | writes the full runtime audit artifact before review uses compact output | Retain at semantic owner |
| `blocked-promoter/blocker-policy.test.ts` | keeps dependency-waiting and resolved tasks out of owner-question selection | Retain at semantic owner |
| `blocked-promoter/blocker-policy.test.ts` | projects satisfied capabilities as promotable and hard dependencies take precedence | Retain at semantic owner |
| `blocked-promoter/blocker-policy.test.ts` | uses one freshness boundary for owner requests and digest suppression | Retain at semantic owner |
| `blocked-promoter/owner-decision-authorization.test.ts` | accepts the explicit displayed unblock token | Retain at semantic owner |
| `blocked-promoter/owner-decision-authorization.test.ts` | does not grant promotion authority to ambiguous '%s' | Retain at semantic owner |
| `blocked-promoter/owner-decision-authorization.test.ts` | rejects unblock when that token was not displayed | Retain at semantic owner |
| `blocked-promoter/owner-decision-authorization.workflow.test.ts` | keeps a negatively phrased task blocked after ambiguous '%s' | Retain at semantic owner |
| `blocked-promoter/owner-decision-authorization.workflow.test.ts` | fails closed when the precondition changes during the owner wait | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | returns null for empty or undefined input | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | parses 'Recommended: <slug>' from a context paragraph | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | parses leading 'Recommended:' on its own | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | returns null when no Recommended line is present | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | includes recommendedAnswer when context names one | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | recommendedAnswer is null when context has no Recommended line | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies capability-installed as still-awaiting-capability when probe fails | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies blocked tasks with unfinished hard dependencies before precondition action | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies a due owner-decision as owner-ask-due with recommendedAnswer | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies an owner-decision with fresh ask marker as owner-ask-recent | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies operator-capture under threshold as operator-capture-fresh | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies a fresh partial operator-capture directory as due | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies aged operator-capture without marker as operator-capture-due | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | classifies aged operator-capture with fresh marker as operator-capture-recent | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | returns aged operator-capture blockers without a fresh marker | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | returns fresh partial operator-capture blockers | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | skips fresh blockers (under threshold) | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | skips aged blockers with a marker fresher than 14 days | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | upserts the marker on a previously unmarked task body | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | refreshes an existing marker timestamp without duplicating | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | reports ageDays alongside each action | Retain at semantic owner |
| `blocked-promoter/promotion.test.ts` | parses freshly-rendered markers | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | auto-promotes tasks whose deterministic preconditions are satisfied | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | keeps a partial operator-capture directory blocked and refreshes instructions | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | re-asks the owner for a due owner-decision and promotes on approval | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | refreshes the asked marker on a non-approval answer without promoting | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | skips owner ask when the marker is fresher than 14 days | Retain workflow routing seam: successful queue processing emits no blocked owner request for the recently asked task; catches ignoring the blocker decision when publishing follow-ups |
| `blocked-promoter/workflow.test.ts` | does not declare runtime recovery as a trigger | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `blocked-promoter/workflow.test.ts` | instructs an aged operator-capture blocker and writes the run artifact | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | does not re-instruct an aged operator-capture within the cadence | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | surfaces the recommended option in the owner-ask question | Retain at semantic owner |
| `blocked-promoter/workflow.test.ts` | promotes already-resolved owner-decision tasks deterministically | Retain at semantic owner |
| `builder/workflow.test.ts` | binds each run to its task resource and shared write sandbox | Retain at semantic owner |
| `builder/workflow.test.ts` | ignores retained worker notes but rejects changes to the admitted source | Retain at semantic owner |
| `builder/workflow.test.ts` | rechecks the admitted source contract after reconciliation | Retain at semantic owner |
| `builder/workflow.test.ts` | runs build only after target and harness preflights succeed | Retain at semantic owner |
| `builder/workflow.test.ts` | writes calibration from the builder critic directory, ignoring stale run-root evidence | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | reports quiet when no runs and nothing pending | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | collects integrated builder commits from runtime delivery evidence | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | ignores runs older than the window | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | collects blocked-promoter moves into open | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | collects failed monitored runs | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | does not collect failed runs that are not monitored | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | collects pending owner questions sorted by age | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | surfaces aged operator-capture preconditions past 14 days | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | does not surface operator-capture preconditions under 14 days | Retain at semantic owner |
| `daily-digest/aggregate.test.ts` | computes queue delta against previous snapshot | Retain at semantic owner |
| `daily-digest/digest-cli.test.ts` | prints the same body renderOnDemandDigest produces | Retain at semantic owner |
| `daily-digest/digest-cli.test.ts` | --json emits the structured DailyDigestData payload | Retain at semantic owner |
| `daily-digest/digest-route.test.ts` | returns the same body and structured payload renderOnDemandDigest produces | Retain at semantic owner |
| `daily-digest/digest-route.test.ts` | does not create cadence state or emit workflow.daily.digest | Retain at semantic owner |
| `daily-digest/digest-route.test.ts` | rejects requests without the bearer token | Retain at semantic owner |
| `daily-digest/digest-route.test.ts` | rejects a non-numeric windowEndMs query parameter | Retain at semantic owner |
| `daily-digest/on-demand.test.ts` | returns the rendered digest body without creating cadence state | Retain at semantic owner |
| `daily-digest/on-demand.test.ts` | does not emit workflow.daily.digest | Retain at semantic owner |
| `daily-digest/on-demand.test.ts` | uses the persisted cadence snapshot for the queue delta baseline | Retain at semantic owner |
| `daily-digest/on-demand.test.ts` | reads pending owner questions from the requested scope directory | Retain at semantic owner |
| `daily-digest/render.test.ts` | renders quiet window with no-activity message | Retain at semantic owner |
| `daily-digest/render.test.ts` | renders active window with all seven categories | Retain at semantic owner |
| `daily-digest/workflow.test.ts` | registers without errors and exposes one cron-scheduled code step | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `daily-digest/workflow.test.ts` | has no runtime.idle trigger (workflows AGENTS.md rule) | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `daily-digest/workflow.test.ts` | does not subscribe to its own completion (no self-trigger loop) | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `daily-digest/workflow.test.ts` | emits workflow.daily.digest event and writes both artifact files | Consolidate into: publishes a quiet digest and advances the next queue delta from the completed snapshot |
| `daily-digest/workflow.test.ts` | computes a delta on the second invocation using the persisted snapshot | Consolidate into: publishes a quiet digest and advances the next queue delta from the completed snapshot |
| `decomposer/assessment-ownership.test.ts` | resolves the exact task bound to the failed builder trigger | Retain at semantic owner |
| `decomposer/assessment-ownership.test.ts` | treats a canonical task-content change as a changed immutable contract | Retain at semantic owner |
| `decomposer/assessment-ownership.test.ts` | rejects source metadata outside the builder queue contract | Retain at semantic owner |
| `decomposer/decomposition-actions.test.ts` | creates ordered open tasks and archives the original through task APIs | Retain at semantic owner |
| `decomposer/decomposition-actions.test.ts` | rejects an existing decomposition before creating subtasks | Retain at semantic owner |
| `decomposer/decomposition-check.test.ts` | accepts a dropped original and open subtasks changed by the run | Retain at semantic owner |
| `decomposer/decomposition-check.test.ts` | reads canonical task ids that end in a hyphen | Retain at semantic owner |
| `decomposer/decomposition-check.test.ts` | rejects an original left in the active queue | Retain at semantic owner |
| `decomposer/decomposition-check.test.ts` | rejects a dropped original without named subtasks | Retain at semantic owner |
| `decomposer/decomposition-check.test.ts` | rejects a referenced subtask outside open | Retain at semantic owner |
| `decomposer/decomposition-check.test.ts` | rejects task files not changed by the decomposition run | Retain at semantic owner |
| `decomposer/decomposition-plan.test.ts` | accepts dependencies on earlier subtasks | Retain at semantic owner |
| `decomposer/decomposition-plan.test.ts` | rejects dependencies on the same or a later subtask | Retain at semantic owner |
| `decomposer/decomposition-plan.test.ts` | decodes an explicit semantic review decision | Retain at semantic owner |
| `decomposer/exposed-output-trust.test.ts` | marks the task snapshot and typed plan as separate untrusted agent inputs | Retain at semantic owner |
| `decomposer/task-read-security.test.ts` | rejects %s | Retain at semantic owner |
| `decomposer/task-read-security.test.ts` | rejects source metadata with mismatched %s | Retain at semantic owner |
| `decomposer/task-read-security.test.ts` | rejects source metadata without the immutable builder task contract | Retain at semantic owner |
| `decomposer/task-read-security.test.ts` | does not expose a sibling-project task reached through a task symlink | Retain at semantic owner |
| `decomposer/workflow.test.ts` | keeps both reasoning steps read-only and exposes the plan to review | Retain at semantic owner |
| `decomposer/workflow.test.ts` | derives RunState ownership from the failed builder's immutable task contract | Consolidate into: binds the task resource from the failed builder's immutable task contract |
| `decomposer/workflow.test.ts` | rejects resource admission when source metadata lacks the task contract | Retain at semantic owner |
| `decomposer/workflow.test.ts` | rechecks the failed builder's source contract after reconciliation | Retain at semantic owner |
| `decomposer/workflow.test.ts` | rejects unsupported triggers and malformed completion payloads | Retain at semantic owner |
| `decomposer/workflow.test.ts` | skips decomposition for a builder failure outside the rescope classes | Retain at semantic owner |
| `decomposer/workflow.test.ts` | decomposes an unchanged task after %s | Retain at semantic owner |
| `decomposer/workflow.test.ts` | skips a task whose immutable contract changed after builder admission | Retain at semantic owner |
| `decomposer/workflow.test.ts` | rejects a semantically misaligned plan before task mutation | Retain at semantic owner |
| `decomposer/workflow.test.ts` | rechecks the immutable task contract immediately before mutation | Retain at semantic owner |
| `dispatcher/semantic-reflection.test.ts` | parks a clean isolated snapshot while the canonical scope is dirty | Retain at semantic owner |
| `dispatcher/semantic-reflection.test.ts` | emits one parked-queue review and ignores five later build commits | Retain at semantic owner |
| `dispatcher/semantic-reflection.test.ts` | emits a task-disposition boundary when a task becomes blocked | Retain at semantic owner |
| `dispatcher/semantic-reflection.test.ts` | emits once when an owner decision resolves without a Git commit | Retain at semantic owner |
| `dispatcher/semantic-reflection.test.ts` | emits a strategic-completion boundary for a completed P1 initiative | Retain at semantic owner |
| `dispatcher/semantic-request-queue.test.ts` | preserves every explicit progress request beside one latest automatic revision | Retain at semantic owner |
| `dispatcher/semantic-request-queue.test.ts` | preserves explicit scope requests beside one latest policy fingerprint | Retain at semantic owner |
| `dispatcher/semantic-request-queue.test.ts` | rejects consumed progress revisions and scope fingerprints before queue insertion | Retain at semantic owner |
| `dispatcher/semantic-task-transitions.test.ts` | parses task additions, removals, modifications, and renames | Retain at semantic owner |
| `dispatcher/semantic-task-transitions.test.ts` | uses the run-owned command rail and treats an unavailable range as unknown | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | runs the ongoing semantic observer without a Git repository | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits one targeted autonomy.queue.available event per open task | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | keeps proposed tasks visible without admitting builder execution | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | does not admit builder work when the complete write decision denies it | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | parks malformed improvement config and keeps builder work undispatched | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | does not treat open work with unfinished hard dependencies as actionable | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | treats open work as actionable once hard dependencies are done | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits autonomy.inbox.available when inbox has items | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits autonomy.queue.empty when nothing to do | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | stays quiescent when only dependency-blocked work remains | Consolidate into: keeps dependency-blocked work out of builder and explorer routes |
| `dispatcher/workflow.test.ts` | does not dispatch when only blocked work remains | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits blocked-research attemptable without queue.available for a blocked-only retry candidate | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits security-review due when security-sensitive source changed since review | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits one scope review only for a changed content/policy fingerprint | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | does not emit blocked-research attemptable when capability is missing | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | does not emit blocked-research attemptable when the retry fingerprint is unchanged | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits autonomy.queue.thin for a one-item active queue | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits autonomy.queue.thin when two open tasks remain | Delete repeated threshold value; representative thin/non-thin routing remains |
| `dispatcher/workflow.test.ts` | does not emit autonomy.queue.thin when three or more tasks remain | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | does not emit autonomy.queue.empty when active work still exists | Retain at semantic owner |
| `dispatcher/workflow.test.ts` | emits both queue.available and inbox.available when both have items | Retain at semantic owner |
| `evaluator-calibration-monitor/workflow.test.ts` | registers as a read-only observer of completed builder runs | Retain at semantic owner |
| `evaluator-calibration-monitor/workflow.test.ts` | publishes gated evidence without creating repository work | Retain at semantic owner |
| `evaluator-calibration-monitor/workflow.test.ts` | records healthy calibration without emitting a regression | Retain at semantic owner |
| `evaluator-calibration-notify/workflow.test.ts` | registers with a single trigger on the typed calibration regression event | Retain at semantic owner |
| `evaluator-calibration-notify/workflow.test.ts` | emits workflow.attention.digest carrying the contradiction rate and reason | Retain at semantic owner |
| `evaluator-calibration-notify/workflow.test.ts` | formats rates as percentages and references the contradiction ratio | Delete duplicate; published calibration notification already observes rates and reason |
| `explorer/explorer-publication.test.ts` | does not advance the canonical cooldown from the writer run | Retain at semantic owner |
| `explorer/watchlist.test.ts` | parses the seed format with only url + added fields | Retain at semantic owner |
| `explorer/watchlist.test.ts` | round-trips a watchlist with snapshots through parse + serialize | Retain at semantic owner |
| `explorer/watchlist.test.ts` | rejects a snapshot block missing required fields | Retain at semantic owner |
| `explorer/watchlist.test.ts` | rejects unknown top-level fields | Retain at semantic owner |
| `explorer/watchlist.test.ts` | rejects canonicalized aliases that remain listed as refresh resources | Retain at semantic owner |
| `explorer/watchlist.test.ts` | is stable across trivial whitespace churn | Retain at semantic owner |
| `explorer/watchlist.test.ts` | strips ISO date timestamps | Retain at semantic owner |
| `explorer/watchlist.test.ts` | strips relative time churn | Retain at semantic owner |
| `explorer/watchlist.test.ts` | produces different output for genuinely different content | Retain at semantic owner |
| `explorer/watchlist.test.ts` | returns inaccessible when the outcome is inaccessible | Retain at semantic owner |
| `explorer/watchlist.test.ts` | returns new when there is no prior snapshot | Retain at semantic owner |
| `explorer/watchlist.test.ts` | returns unchanged when the fingerprint matches | Retain at semantic owner |
| `explorer/watchlist.test.ts` | treats trivial date-only churn as unchanged | Retain at semantic owner |
| `explorer/watchlist.test.ts` | returns changed when content has meaningfully shifted | Retain at semantic owner |
| `explorer/watchlist.test.ts` | writes a snapshot for a newly-seen entry | Retain at semantic owner |
| `explorer/watchlist.test.ts` | marks inaccessible entries with status: inaccessible | Retain at semantic owner |
| `explorer/watchlist.test.ts` | clears inaccessible status when an entry becomes reachable again | Retain at semantic owner |
| `explorer/watchlist.test.ts` | refreshes last_seen_at but not fingerprint when unchanged | Retain at semantic owner |
| `explorer/watchlist.test.ts` | canonicalizes a redirect-only repository entry to a new target | Retain at semantic owner |
| `explorer/watchlist.test.ts` | canonicalizes a moved-project pointer to an already tracked target | Retain at semantic owner |
| `explorer/watchlist.test.ts` | removes duplicate entries when a redirect target is already tracked | Retain at semantic owner |
| `explorer/watchlist.test.ts` | skips unknown URLs without mutating the rest of the file | Retain at semantic owner |
| `explorer/watchlist.test.ts` | returns null when the file is absent | Retain at semantic owner |
| `explorer/watchlist.test.ts` | parses a valid updates file | Retain at semantic owner |
| `explorer/watchlist.test.ts` | rejects an accessible update missing content | Retain at semantic owner |
| `explorer/workflow-refresh.test.ts` | runs explore when the queue is empty and refresh is due | Retain at semantic owner |
| `explorer/workflow-refresh.test.ts` | does not write lastExplorationAt when explore step is skipped | Retain at semantic owner |
| `explorer/workflow-refresh.test.ts` | skips explore when worktree is dirty | Retain at semantic owner |
| `explorer/workflow-refresh.test.ts` | trigger cooldowns match the exploration refresh window to prevent no-op churn | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `explorer/workflow-refresh.test.ts` | does not starve exploration when skipped runs repeatedly complete | Retain at semantic owner |
| `explorer/workflow-thin-queue.test.ts` | runs explore when a single open task remains and refresh is due | Retain at semantic owner |
| `explorer/workflow-thin-queue.test.ts` | skips explore when the queue is empty but the refresh window is not due | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | creates a repo-local task and stages a post-integration comment request | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | uses only routed dispatcher payloads and explicitly no-ops non-implementation mentions | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | asks for acceptance detail and creates no task for vague implementation mentions | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | asks for a safe restatement and creates no task for unsafe implementation mentions | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | asks for a safe restatement and creates no task when the issue title is unsafe | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | uses the shared detector for instruction text that bypassed the legacy blacklist | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | keeps closing tags and markdown fences inside the task source boundary | Retain at semantic owner |
| `github-mention-intake/workflow.test.ts` | does not create tasks or post reference comments for untrusted, malformed, unsupported, or non-implementation payloads | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | declares routed response and post-integration intake triggers | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | posts a prepared intake comment without running the response agent | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | runs an allowed mention through draft, approval, and exactly one github_comment write | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | skips blocked actors before agent or comment write | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | skips low-trust actors before agent or comment write | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | skips missing actor metadata before agent or comment write | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | skips malformed normalized payloads before agent or comment write | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | records unsupported comment actions before agent or comment write | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | leaves implementation requests to the intake workflow without running the agent or posting from the responder | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | blocks suspected private-key material from response output before persisting the agent body or writing a GitHub comment | Retain at semantic owner |
| `github-mention-responder/workflow.test.ts` | wraps hostile GitHub issue and comment text in the untrusted-content marker before drafting | Delete literal prompt/marker assertion; core injection/output boundary remains authoritative |
| `improver/deterministic-recovery.test.ts` | executes and verifies only the allowlisted doctor repair | Retain at semantic owner |
| `improver/deterministic-recovery.test.ts` | rejects runtime conditions that doctor does not inspect or repair | Retain at semantic owner |
| `improver/issue-disposition.test.ts` | accepts the %s no-work outcome | Retain at semantic owner |
| `improver/issue-disposition.test.ts` | requires a durable issue identity for a duplicate disposition | Retain at semantic owner |
| `improver/issue-disposition.test.ts` | admits only the allowlisted deterministic recovery action | Retain at semantic owner |
| `improver/workflow.test.ts` | has no generic successful-completion trigger or implementation write scope | Retain at semantic owner |
| `improver/workflow.test.ts` | reviews one undecided semantic revision and does not review it again | Retain at semantic owner |
| `improver/workflow.test.ts` | publishes verified deterministic recovery as a clear observation | Retain at semantic owner |
| `improver/workflow.test.ts` | routes a repair through one stable task and resolves it on a revised issue | Retain at semantic owner |
| `inbox-sorter/workflow.test.ts` | skips sorting when inbox is empty | Retain at semantic owner |
| `inbox-sorter/workflow.test.ts` | rejects untracked files outside inbox | Retain at semantic owner |
| `inbox-sorter/workflow.test.ts` | allows untracked inbox entries | Retain at semantic owner |
| `inbox-sorter/workflow.test.ts` | rejects tracked changes outside inbox | Retain at semantic owner |
| `inbox-sorter/workflow.test.ts` | sorts populated inboxes and validates the resulting queue | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | keeps the review agent passive without unsupported named native-tool policy | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `pr-reviewer/workflow.test.ts` | skips when action is not opened or synchronize | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips when action is labeled (non-reviewable) | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `pr-reviewer/workflow.test.ts` | skips when headBranch is null | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips when the head SHA is missing | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips when PR is from a fork | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips low-trust same-repository PRs before review | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips configured blocked actors before review | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips when actor integrity metadata is missing | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | reviews a synchronize event without imposing a branch naming convention | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | reviews an opened trusted same-repository PR | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | emits workflow.pr.review.posted after successful review | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | fails malformed review output before any GitHub comment write | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | fails empty review output before any GitHub comment write | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | blocks suspected tokens from review output before persisting the agent body or writing a GitHub comment | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | bounds oversized review text before posting one GitHub comment | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | does not emit when review is skipped | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | skips when explicit fork status is missing | Retain at semantic owner |
| `pr-reviewer/workflow.test.ts` | wraps hostile GitHub payload text in the untrusted-content marker before review | Delete literal prompt/marker assertion; core injection/output boundary remains authoritative |
| `progress-reviewer/progress-review/artifact.test.ts` | writes progress-review and review-scrutiny artifacts | Retain at semantic owner |
| `progress-reviewer/progress-review/canonical-state-evidence.test.ts` | keeps the complete open queue while the compact agent packet points to canonical refs | Retain at semantic owner |
| `progress-reviewer/progress-review/event-evidence-daemon-state.test.ts` | backfills from the daemon stateDir journal when the scope-local journal is absent | Retain at semantic owner |
| `progress-reviewer/progress-review/event-evidence-daemon-state.test.ts` | loads global scope configuration from the daemon stateDir | Retain at semantic owner |
| `progress-reviewer/progress-review/event-evidence-journal-backfill.test.ts` | backfills dropped run, task, and message batch context from the journal | Retain at semantic owner |
| `progress-reviewer/progress-review/event-evidence-journal-backfill.test.ts` | records explicit exclusions when dropped inputs cannot be backfilled | Retain at semantic owner |
| `progress-reviewer/progress-review/proposal-resolution.test.ts` | drops stale steering work when canonical recovery evidence disproves it | Retain at semantic owner |
| `progress-reviewer/progress-review/pruned-run-evidence.test.ts` | accepts validated policy-pruned evidence refs and rejects spoofed retained ids | Retain at semantic owner |
| `progress-reviewer/semantic-input.test.ts` | publishes the consumed watermark through compare-and-set | Retain at semantic owner |
| `progress-reviewer/semantic-input.test.ts` | rejects a stale competing publication instead of overwriting it | Retain at semantic owner |
| `progress-reviewer/semantic-input.test.ts` | keeps explicit requests reviewable without advancing automatic state | Retain at semantic owner |
| `progress-reviewer/semantic-input.test.ts` | rejects malformed automatic requests before review work starts | Retain at semantic owner |
| `progress-reviewer/semantic-input.test.ts` | retains explicit publication receipts when automatic consumption advances | Retain at semantic owner |
| `progress-reviewer/semantic-input.test.ts` | upgrades persisted automatic watermarks and rejects malformed publication receipts | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | reconciles delayed task publication against canonical disposition (retired: %s) | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | preserves an owner's answer when automatic revision %s arrives after revision 2 | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | publishes explicit owner requests without advancing the automatic watermark | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | completes a delayed disposition unless superseded by $newerKind (completed: $completed) | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | publishes a fresh question after task completion through %s disposition | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | preserves answered explicit questions across a later request (same topic: %s) | Retain at semantic owner |
| `progress-reviewer/semantic-publication.test.ts` | consumes an out-of-order explicit request without losing unrelated work (same topic: %s) | Retain at semantic owner |
| `progress-reviewer/workflow-citation-correction.test.ts` | corrects schema-valid unknown evidence IDs before apply-actions | Retain at semantic owner |
| `progress-reviewer/workflow-citation-correction.test.ts` | fails closed with a retained diagnostic after repeated unknown evidence IDs | Retain at semantic owner |
| `progress-reviewer/workflow-citation-correction.test.ts` | keeps unrelated harness failures terminal instead of recording output rejection | Retain at semantic owner |
| `progress-reviewer/workflow-evidence-integrity.test.ts` | binds runtime-authored evidence to its pre-agent digest | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | declares only semantic requests without direct inbound-signal or build triggers | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | writes an explicit no-op artifact for an autonomous coding scope review | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | cleans native harness scratch artifacts before write-scope enforcement | Delete copied native artifact cleanup; core agent write-scope owner |
| `progress-reviewer/workflow.test.ts` | classifies an explicit request in the review artifact | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | writes a global review artifact for an explicit global request | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | creates one follow-up transition and suppresses unchanged record rewrites and attention | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | stages an owner question when a topic changes from task to owner decision | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | does not treat build commits as semantic progress boundaries | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | keeps workflow batch run ids citeable when recent runs are truncated | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | quarantines malformed terminal batch run metadata without blocking review | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | builds a bounded review-agent packet and validates only exposed ids | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | keeps high-signal run artifacts in the bounded review-agent packet | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | normalizes compacted child evidence ids to exposed parent ids | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | normalizes untrusted follow-up task fields before writing task files | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | keeps bracket-wrapped follow-up task prose out of frontmatter | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | runs review-evidence with schema-valid JSON when raw run-count evidence exceeds the step output limit | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | normalizes review-evidence output that cites compacted-away child ids | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | keeps directory scope evidence isolated to the selected scope directory | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | collects approval outcomes as citeable review evidence | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | collects nested step artifacts as citeable run evidence | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | rejects unsafe or mismatched run metadata ids before path lookup | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | collects pending workflow runs as citeable run evidence | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | fails closed for malformed terminal evidence retained by an undelivered publication | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | collects open dead-letter queue counts and citeable item evidence | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | keeps tasks referenced by dead-letter reasons citeable | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | bounds dead-letter ids in the compact agent packet | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | stops artifact traversal at the max artifact count | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | does not traverse artifact directories at the max artifact depth | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | collects recent committed file changes through the workflow command rail | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | collects global scope evidence from every configured directory scope | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | uses central durable authority for finalized evidence in a non-default active scope | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | bounds global evidence independently for each configured directory scope | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | does not use a related inbox title as generated-work identity | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | uses scope-local proposal identity instead of cross-scope title matching | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | rejects malformed structured review output before actions are applied | Retain at semantic owner |
| `progress-reviewer/workflow.test.ts` | rejects review evidence ids outside the collected packet | Retain at semantic owner |
| `publication-resource-isolation.test.ts` | queues same-domain writers without blocking unrelated domains or scopes | Consolidate into: shares issue ownership while separating review domains |
| `repo-ai-checks/workflow.test.ts` | keeps the check agent passive without unsupported named native-tool policy | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `repo-ai-checks/workflow.test.ts` | skips irrelevant, fork, and low-trust PR events before discovery | Retain at semantic owner |
| `repo-ai-checks/workflow.test.ts` | executes discovered trusted-base checks, writes artifacts, and emits a typed summary | Retain at semantic owner |
| `repo-ai-checks/workflow.test.ts` | posts one bounded advisory comment through github_comment when policy and approval allow it | Retain at semantic owner |
| `repo-ai-checks/workflow.test.ts` | fails malformed check agent output before summary artifacts or comments | Retain at semantic owner |
| `research-retry/workflow.test.ts` | wakes only from blocked research availability | Retain at semantic owner |
| `research-retry/workflow.test.ts` | rejects unsupported triggers and malformed availability before candidate inspection | Retain at semantic owner |
| `research-retry/workflow.test.ts` | runs task validation through the supervised command rail | Delete command-spelling spy; shared repair execution and task validator own rejection |
| `research-retry/workflow.test.ts` | skips the agent step when there are no blocked research candidates | Retain at semantic owner |
| `research-retry/workflow.test.ts` | skips the agent step when worktree is dirty | Retain at semantic owner |
| `research-retry/workflow.test.ts` | classifies candidates as unavailable when every URL lacks its capability | Retain at semantic owner |
| `research-retry/workflow.test.ts` | classifies an unchanged URL fingerprint as already attempted | Retain at semantic owner |
| `research-retry/workflow.test.ts` | picks the next candidate when the oldest URL set was already attempted | Retain at semantic owner |
| `research-retry/workflow.test.ts` | picks the first stable task identity when capability is met | Retain at semantic owner |
| `research-retry/workflow.test.ts` | writeMarkerForCandidate refreshes the marker after the agent edits resources | Retain at semantic owner |
| `research-retry/workflow.test.ts` | writeMarkerForCandidate is a no-op when the task moved out of blocked | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | rejects an alternate-run metadata id before the gate suppressor reads artifacts | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | ignores missing agent runtime evidence from infrastructure failed steps | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | keeps missing agent runtime evidence from unclassified failed steps actionable | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | does not suppress approval gate gaps with escaping step evidence refs | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | does not suppress approval gate gaps from skipped non-gate step artifacts | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | distinguishes producer-missing control evidence from policy-pruned run references | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts` | requests one decision for recurring control coverage gaps | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts` | does not route declared unsupported agent streams into repair tasks | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts` | surfaces terminal unknown evidence without classifying owner interruption as local-code | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts` | ignores stale skipped approval gate gaps from historical coverage artifacts | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts` | ignores stale skipped owner-wait gate gaps from historical coverage artifacts | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-interruptions.test.ts` | requests one root-cause decision for repeated interrupted runs | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-interruptions.test.ts` | routes known runtime abort interruptions outside local repair tasks | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-interruptions.test.ts` | suppresses interrupted runs recovered by a newer success | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-operator-evidence.test.ts` | reads status-derived operator runtime warnings from daemon control evidence | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-operator-evidence.test.ts` | reads daemon stop timeout evidence recorded by daemon-ops | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit-operator-evidence.test.ts` | keeps noisy external provider failures out of local repair tasks | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit.test.ts` | routes Telegram getUpdates conflicts to one issue decision | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit.test.ts` | requests one issue decision for stale open DLQ items | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit.test.ts` | keeps classified agent transport DLQs separate from local execution repairs | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit.test.ts` | audits after restart recovery repairs historical authority metadata | Retain at semantic owner |
| `runtime-health-auditor/runtime-health-audit.test.ts` | does not infer issue disposition from a title-related active task | Retain at semantic owner |
| `scope-improver/scope-fingerprint.test.ts` | ignores builder worktrees and runtime evidence guidance files | Retain at semantic owner |
| `scope-improver/scope-fingerprint.test.ts` | ignores scope-config formatting but changes for resolved authority policy | Retain at semantic owner |
| `scope-improver/scope-fingerprint.test.ts` | canonicalizes scope-improvement config JSON | Retain at semantic owner |
| `scope-improver/scope-fingerprint.test.ts` | rejects a resolved policy snapshot from another scope | Retain at semantic owner |
| `scope-improver/scope-improvement-actions.test.ts` | creates a normal task for missing guidance in a task-proposal posture | Retain at semantic owner |
| `scope-improver/scope-improvement-actions.test.ts` | turns task candidates into owner questions in observe posture | Retain at semantic owner |
| `scope-improver/scope-improvement-actions.test.ts` | resolves write-denied supervised policy to observe posture | Retain at semantic owner |
| `scope-improver/scope-improvement-actions.test.ts` | commits the task drop when one proposal changes to an owner question | Retain at semantic owner |
| `scope-improver/scope-improvement-authority.test.ts` | rejects malformed explicit configuration instead of applying enabled defaults | Retain at semantic owner |
| `scope-improver/scope-improvement-authority.test.ts` | enables builder authority when a bounded policy exposes writable roots | Retain at semantic owner |
| `scope-improver/scope-improvement-authority.test.ts` | resolves confirmation-required task writes to owner questions | Retain at semantic owner |
| `scope-improver/scope-improvement-publication.test.ts` | publishes distinct explicit requests independently of timestamp order (%s) | Retain at semantic owner |
| `scope-improver/scope-improvement-publication.test.ts` | publishes delayed automatic task effects unless a later disposition retired the task (%s) | Retain at semantic owner |
| `scope-improver/scope-improvement-publication.test.ts` | consumes a delayed explicit request while preserving a newer %s disposition | Retain at semantic owner |
| `scope-improver/scope-improvement-publication.test.ts` | completes delayed task-to-question publication unless superseded by %s | Retain at semantic owner |
| `scope-improver/scope-improvement-publication.test.ts` | publishes a fresh observe question beside an existing %s task without changing it | Retain at semantic owner |
| `scope-improver/semantic-request.test.ts` | durably reserves and emits one initial request across restart replay | Retain at semantic owner |
| `scope-improver/workflow-semantic-consumption.test.ts` | reserves one later review only after durable guidance changes | Retain at semantic owner |
| `scope-improver/workflow-semantic-consumption.test.ts` | observes later guidance changes in a non-Git observe scope | Retain at semantic owner |
| `scope-improver/workflow-semantic-consumption.test.ts` | keeps explicit requests independent of the automatic fingerprint | Retain at semantic owner |
| `scope-improver/workflow-semantic-consumption.test.ts` | persists deferred automatic input and resumes it after cleanup | Retain at semantic owner |
| `scope-improver/workflow-semantic-consumption.test.ts` | keeps disabled input parked until the configuration fingerprint changes | Retain at semantic owner |
| `scope-improver/workflow-semantic-consumption.test.ts` | parks malformed configuration without admitting a semantic request | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | registers only explicit semantic requests | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | delegates task effects to one isolated writer workflow | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | returns a clean parked action outcome when current policy denies writes | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | rechecks live posture before the writer mutates task state | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | does not integrate task proposals that still require owner confirmation | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | waits for proposed-task effects before publishing the review | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | publishes a late writer-policy denial as deferred instead of failing | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | publishes disabled automatic input as deferred instead of stranding it queued | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | recomputes current guidance when a queued automatic request becomes stale | Retain at semantic owner |
| `scope-improver/workflow.test.ts` | publishes owner effects idempotently and returns transactional state | Retain at semantic owner |
| `security-review/due-check.test.ts` | reports due when security-sensitive source changes after the last review | Retain at semantic owner |
| `security-review/due-check.test.ts` | reports due for scanner-matched security-sensitive changes outside preferred prefixes | Retain at semantic owner |
| `security-review/due-check.test.ts` | reports not due when the current head has already been reviewed | Retain at semantic owner |
| `security-review/due-check.test.ts` | defers routine review when open security follow-up tasks already exist | Retain at semantic owner |
| `security-review/due-check.test.ts` | does not repeat after review evidence records the changed head | Retain at semantic owner |
| `security-review/workflow-finding-run.test-cases.ts` | turns confirmed revalidation findings into tasks and leaves rejected findings in artifacts | Retain at semantic owner |
| `security-review/workflow-finding-run.test-cases.ts` | writes preflight diagnostics and skips commit when task validation fails | Retain at semantic owner |
| `security-review/workflow-finding-run.test-cases.ts` | fails when revalidation omits an investigation finding | Retain at semantic owner |
| `security-review/workflow-run.test-cases.ts` | completes as an explicit no-op when the deterministic scan is empty | Retain at semantic owner |
| `security-review/workflow-run.test-cases.ts` | does not declare runtime recovery as a trigger | Delete declarative/private-shape duplication; validation/types or retained semantic scenario supplies proof |
| `security-review/workflow-run.test-cases.ts` | accepts due events while retaining the manual request trigger | Retain at semantic owner |
| `security-review/workflow-run.test-cases.ts` | keeps full scan evidence in the artifact while exposing compact candidate metadata | Retain at semantic owner |
| `security-review/workflow-scan.test-cases.ts` | discovers repo-local candidates across KOTA security-sensitive surfaces | Retain at semantic owner |
| `security-review/workflow-scan.test-cases.ts` | prioritizes source implementation candidates over generated and prose noise | Retain at semantic owner |
| `security-review/workflow-scan.test-cases.ts` | prioritizes bounded security-sensitive due paths | Retain at semantic owner |
| `security-review/workflow-scan.test-cases.ts` | selects one representative per due target before enforcing per-surface caps | Retain at semantic owner |
| `security-review/workflow-scan.test-cases.ts` | reports due target cap misses when the hard global cap is exhausted | Retain at semantic owner |
| `security-review/workflow-scan.test-cases.ts` | uses surface-specific source priority before lexicographic path order | Retain at semantic owner |
| `security-review/workflow-task-identity.test-cases.ts` | reopens a terminal task with new provenance instead of creating a duplicate | Retain at semantic owner |
| `security-review/workflow-task-identity.test-cases.ts` | merges an explicitly superseded duplicate into the canonical stable-identity record | Retain at semantic owner |
| `security-review/workflow-task.test-cases.ts` | decodes investigation and revalidation output before creating confirmed follow-up tasks | Retain at semantic owner |
| `security-review/workflow-task.test-cases.ts` | allocates a unique active id when terminal task ids collide with the finding slug | Retain at semantic owner |
| `security-review/workflow-task.test-cases.ts` | quotes agent-generated task content before it can become task structure | Retain at semantic owner |
| `security-review/workflow-task.test-cases.ts` | states the authorized defensive scope in the agent prompt | Delete literal prompt/marker assertion; core injection/output boundary remains authoritative |
| `security-review/workflow-task.test-cases.ts` | keeps the revalidation prompt aligned with the required summary field | Delete literal prompt/marker assertion; core injection/output boundary remains authoritative |
| `security-review/workflow.test.ts` | declares retryable output schemas for run-observed malformed agent output | Retain at semantic owner |

The mismatched metadata-ID parameter was removed from the decomposer matrix because core metadata authority rejects it before workflow execution; workflow/status/run-directory mismatches and task-path/source authentication remain. Decomposer resource tests now compare the binding only; core resource allocation proves contention and cross-scope namespacing. The publication resource scenario likewise compares shared versus disjoint domain keys.

### Fixture/support disposition

| Support | Final consumers | Disposition |
| --- | --- | --- |
| `decomposer/workflow-test-support.ts` | `src/modules/autonomy/workflow-blocking-queue-and-discovery.integration.test.ts`, `decomposer/assessment-ownership.test.ts`, `decomposer/task-read-security.test.ts`, `decomposer/workflow.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `progress-reviewer/__fixtures__/autonomous-coding-review.json` | `progress-reviewer/workflow.test.ts` | Retain authored agent-output example validated by production decoder; not an eval migration |
| `progress-reviewer/__fixtures__/channel-processing-review.json` | `progress-reviewer/workflow.test.ts` | Retain authored agent-output example validated by production decoder; not an eval migration |
| `progress-reviewer/progress-review/event-evidence-test-support.ts` | `progress-reviewer/progress-review/event-evidence-daemon-state.test.ts`, `progress-reviewer/progress-review/event-evidence-journal-backfill.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `progress-reviewer/workflow.test-helpers.ts` | `progress-reviewer/workflow-citation-correction.test.ts`, `progress-reviewer/workflow-evidence-integrity.test.ts`, `progress-reviewer/workflow.test.ts`, `progress-reviewer/progress-review/canonical-state-evidence.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `runtime-health-auditor/runtime-health-audit-control-coverage-test-context.ts` | `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts`, `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `runtime-health-auditor/runtime-health-audit-control-coverage-test-support.ts` | `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts`, `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `runtime-health-auditor/runtime-health-audit-test-context.ts` | `runtime-health-auditor/runtime-health-audit-interruptions.test.ts`, `runtime-health-auditor/runtime-health-audit-operator-evidence.test.ts`, `runtime-health-auditor/runtime-health-audit.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `scope-improver/scope-policy-test-support.ts` | `scope-improver/workflow.test-helpers.ts`, `scope-improver/scope-improvement-actions.test.ts`, `scope-improver/scope-improvement-authority.test.ts`, `scope-improver/semantic-request.test.ts`, `scope-improver/workflow-semantic-consumption.test.ts`, `scope-improver/scope-fingerprint.test.ts`, `scope-improver/workflow.test.ts`, `dispatcher/workflow.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `scope-improver/workflow.test-helpers.ts` | `scope-improver/semantic-request.test.ts`, `scope-improver/workflow-semantic-consumption.test.ts`, `scope-improver/workflow.test.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `security-review/workflow-test-fixture.ts` | `security-review/workflow-task-identity.test-cases.ts`, `security-review/workflow-run.test-cases.ts`, `security-review/workflow-task.test-cases.ts`, `security-review/workflow-scan.test-cases.ts`, `security-review/workflow-finding-run.test-cases.ts` | Retain typed semantic inputs / real owner construction; no workflow interpreter |
| `blocked-promoter/owner-decision-test-support.ts` | `blocked-promoter/owner-decision-authorization.workflow.test.ts`, `blocked-promoter/workflow.test.ts` | Replace two copied question queues with real OwnerQuestionQueue and executeWorkflowRun; human answer is the controlled port |
| `git-evidence-test-support.ts` | `dispatcher/semantic-reflection.test.ts`, `dispatcher/workflow.test.ts`, `security-review/due-check.test.ts`, `progress-reviewer/workflow.test.ts` | Control subprocess launch while reading real Git evidence; process identity/supervision stays core-owned |

Inline support: temporary task/repository/run/evidence builders in each retained suite construct inputs for the listed production owner. The two GitHub prompt reconstruction builders, duplicate progress harness/compiler/prompt decoder, blocked-promoter shadow queues/clean-worktree mocks, daily-digest queue module mocks, decomposer action/mutated-path mocks, and retired task-state directory catalogs were removed. Remaining event/registry cleanup releases a production host used by surviving consumers; broad mock-reset hooks were removed. Fixture inputs are authored domain examples, not copied lifecycle state machines.

### LOC accounting

Physical lines including blanks/comments. Same subtree and categories before/after. Production: TypeScript other than test/support; executable tests include `.test.ts` and imported `.test-cases.ts` (these execute assertions); authored support includes typed builders and the two JSON output examples. No generated/vendor/eval snapshot files occur in scope. The checked-in counting utility does not recognize `.test-cases.ts`; this report assigns those executable suites explicitly rather than miscounting them as production. Markdown is excluded.

| Category | Before files / LOC | After files / LOC | LOC delta |
| --- | ---: | ---: | ---: |
| production | 174 / 23,277 | 174 / 23,277 | +0 |
| executable-test | 77 / 20,348 | 76 / 19,089 | -1,259 |
| authored-support | 11 / 1,860 | 13 / 1,951 | +91 |

Inventory reconciliation: all 29 definitions, all baseline scenario templates, and every support file have a disposition. Zero unresolved rows. Per-file counts follow below; validation results and execution limitations are recorded above. Raw inventory and logs also remain in the run artifacts, but are not required to read this record.

### Per-file LOC ledger

Paths are relative to `src/modules/autonomy/workflows`; 0 means absent.

| Source | Category | Before LOC | After LOC |
| --- | --- | ---: | ---: |
| `attention-digest/attention-cli.test.ts` | executable-test | 141 | 141 |
| `attention-digest/attention-cli.ts` | production | 49 | 49 |
| `attention-digest/attention-route.test.ts` | executable-test | 137 | 137 |
| `attention-digest/attention-route.ts` | production | 63 | 63 |
| `attention-digest/blocked-attention.ts` | production | 116 | 116 |
| `attention-digest/step.test.ts` | executable-test | 674 | 631 |
| `attention-digest/step.ts` | production | 190 | 190 |
| `attention-digest/workflow.test.ts` | executable-test | 13 | 0 |
| `attention-digest/workflow.ts` | production | 54 | 54 |
| `autonomy-health-reviewer/action-operations.ts` | production | 30 | 30 |
| `autonomy-health-reviewer/health-review-actions.ts` | production | 183 | 183 |
| `autonomy-health-reviewer/health-review-artifact.ts` | production | 103 | 103 |
| `autonomy-health-reviewer/health-review-dedupe.test.ts` | executable-test | 132 | 132 |
| `autonomy-health-reviewer/health-review-evidence-fingerprint.ts` | production | 30 | 30 |
| `autonomy-health-reviewer/health-review-terminal-task.test.ts` | executable-test | 169 | 169 |
| `autonomy-health-reviewer/health-review-types.ts` | production | 76 | 76 |
| `autonomy-health-reviewer/health-review.test.ts` | executable-test | 375 | 375 |
| `autonomy-health-reviewer/health-review.ts` | production | 240 | 240 |
| `autonomy-health-reviewer/reference-evidence/health-follow-up-20260728/autonomy-change-decision.json` | production | 58 | 58 |
| `autonomy-health-reviewer/review-steps.ts` | production | 23 | 23 |
| `autonomy-health-reviewer/workflow.test.ts` | executable-test | 225 | 224 |
| `autonomy-health-reviewer/workflow.ts` | production | 237 | 237 |
| `autonomy-issue-projection-materialization/workflow.ts` | production | 55 | 55 |
| `blocked-promoter-owner-decision/workflow.ts` | production | 77 | 77 |
| `blocked-promoter/blocker-policy.test.ts` | executable-test | 46 | 46 |
| `blocked-promoter/blocker-policy.ts` | production | 152 | 152 |
| `blocked-promoter/blocking-operations.ts` | production | 108 | 108 |
| `blocked-promoter/owner-decision-authorization.test.ts` | executable-test | 23 | 23 |
| `blocked-promoter/owner-decision-authorization.ts` | production | 91 | 91 |
| `blocked-promoter/owner-decision-authorization.workflow.test.ts` | executable-test | 223 | 152 |
| `blocked-promoter/owner-decision-follow-up.ts` | production | 88 | 88 |
| `blocked-promoter/owner-decision-test-support.ts` | authored-support | 0 | 75 |
| `blocked-promoter/promotion.test.ts` | executable-test | 498 | 498 |
| `blocked-promoter/promotion.ts` | production | 317 | 317 |
| `blocked-promoter/resolution-steps.ts` | production | 123 | 123 |
| `blocked-promoter/workflow.test.ts` | executable-test | 733 | 582 |
| `blocked-promoter/workflow.ts` | production | 221 | 221 |
| `builder/blocking-operations.ts` | production | 47 | 47 |
| `builder/builder-harness-preflight.ts` | production | 62 | 62 |
| `builder/queue-preflight-steps.ts` | production | 39 | 39 |
| `builder/repair-checks.ts` | production | 29 | 29 |
| `builder/task-contract.ts` | production | 215 | 215 |
| `builder/task-state-repair-checks.ts` | production | 54 | 54 |
| `builder/workflow.test.ts` | executable-test | 279 | 279 |
| `builder/workflow.ts` | production | 110 | 110 |
| `builder/workspace.ts` | production | 7 | 7 |
| `daily-digest/aggregate.test.ts` | executable-test | 355 | 355 |
| `daily-digest/aggregate.ts` | production | 405 | 405 |
| `daily-digest/blocking-operations.ts` | production | 39 | 39 |
| `daily-digest/digest-cli.test.ts` | executable-test | 117 | 94 |
| `daily-digest/digest-cli.ts` | production | 40 | 40 |
| `daily-digest/digest-route.test.ts` | executable-test | 133 | 110 |
| `daily-digest/digest-route.ts` | production | 60 | 60 |
| `daily-digest/on-demand.test.ts` | executable-test | 153 | 129 |
| `daily-digest/on-demand.ts` | production | 97 | 97 |
| `daily-digest/render.test.ts` | executable-test | 118 | 118 |
| `daily-digest/render.ts` | production | 213 | 213 |
| `daily-digest/ui-surface.ts` | production | 37 | 37 |
| `daily-digest/workflow.test.ts` | executable-test | 265 | 47 |
| `daily-digest/workflow.ts` | production | 88 | 88 |
| `decomposer/assessment-ownership.test.ts` | executable-test | 68 | 68 |
| `decomposer/assessment-ownership.ts` | production | 90 | 90 |
| `decomposer/assessment.ts` | production | 291 | 291 |
| `decomposer/blocking-operations.ts` | production | 37 | 37 |
| `decomposer/decomposition-actions.test.ts` | executable-test | 132 | 132 |
| `decomposer/decomposition-actions.ts` | production | 154 | 154 |
| `decomposer/decomposition-check.test.ts` | executable-test | 135 | 125 |
| `decomposer/decomposition-check.ts` | production | 60 | 60 |
| `decomposer/decomposition-plan.test.ts` | executable-test | 47 | 47 |
| `decomposer/decomposition-plan.ts` | production | 124 | 124 |
| `decomposer/exposed-output-trust.test.ts` | executable-test | 24 | 24 |
| `decomposer/task-read-security.test.ts` | executable-test | 168 | 159 |
| `decomposer/workflow-test-support.ts` | authored-support | 147 | 147 |
| `decomposer/workflow.test.ts` | executable-test | 378 | 330 |
| `decomposer/workflow.ts` | production | 180 | 180 |
| `dispatcher/inspection.ts` | production | 92 | 92 |
| `dispatcher/semantic-reflection.test.ts` | executable-test | 259 | 259 |
| `dispatcher/semantic-reflection.ts` | production | 196 | 196 |
| `dispatcher/semantic-request-queue.test.ts` | executable-test | 290 | 290 |
| `dispatcher/semantic-scope-reflection.ts` | production | 192 | 192 |
| `dispatcher/semantic-task-transitions.test.ts` | executable-test | 55 | 41 |
| `dispatcher/semantic-task-transitions.ts` | production | 193 | 193 |
| `dispatcher/workflow.test.ts` | executable-test | 683 | 679 |
| `dispatcher/workflow.ts` | production | 231 | 231 |
| `evaluator-calibration-monitor/inspection.ts` | production | 55 | 55 |
| `evaluator-calibration-monitor/workflow.test.ts` | executable-test | 280 | 287 |
| `evaluator-calibration-monitor/workflow.ts` | production | 168 | 168 |
| `evaluator-calibration-notify/workflow.test.ts` | executable-test | 76 | 63 |
| `evaluator-calibration-notify/workflow.ts` | production | 82 | 82 |
| `explorer-publication/workflow.ts` | production | 52 | 52 |
| `explorer/assessment.ts` | production | 45 | 45 |
| `explorer/explorer-publication.test.ts` | executable-test | 85 | 85 |
| `explorer/explorer-publication.ts` | production | 54 | 54 |
| `explorer/explorer-state.ts` | production | 27 | 27 |
| `explorer/watchlist-classifier.ts` | production | 72 | 72 |
| `explorer/watchlist-updates.ts` | production | 310 | 310 |
| `explorer/watchlist.test.ts` | executable-test | 593 | 593 |
| `explorer/watchlist.ts` | production | 316 | 316 |
| `explorer/workflow-refresh.test.ts` | executable-test | 153 | 143 |
| `explorer/workflow-thin-queue.test.ts` | executable-test | 95 | 95 |
| `explorer/workflow.ts` | production | 234 | 234 |
| `git-evidence-test-support.ts` | authored-support | 0 | 19 |
| `github-mention-intake/mention-assessment.ts` | production | 192 | 192 |
| `github-mention-intake/mention-fields.ts` | production | 151 | 151 |
| `github-mention-intake/task-content.ts` | production | 92 | 92 |
| `github-mention-intake/task-support.ts` | production | 168 | 168 |
| `github-mention-intake/workflow.test.ts` | executable-test | 554 | 533 |
| `github-mention-intake/workflow.ts` | production | 176 | 176 |
| `github-mention-responder/workflow-contracts.ts` | production | 240 | 240 |
| `github-mention-responder/workflow.test.ts` | executable-test | 449 | 365 |
| `github-mention-responder/workflow.ts` | production | 201 | 201 |
| `improver-disposition-publication/workflow.ts` | production | 62 | 62 |
| `improver/apply-disposition.ts` | production | 56 | 56 |
| `improver/blocking-operations.ts` | production | 23 | 23 |
| `improver/deterministic-recovery.test.ts` | executable-test | 90 | 90 |
| `improver/deterministic-recovery.ts` | production | 76 | 76 |
| `improver/disposition-publication.ts` | production | 233 | 233 |
| `improver/issue-disposition.test.ts` | executable-test | 54 | 54 |
| `improver/issue-disposition.ts` | production | 119 | 119 |
| `improver/issue-selection.ts` | production | 103 | 103 |
| `improver/issue-work-proposal.ts` | production | 91 | 91 |
| `improver/workflow.test.ts` | executable-test | 488 | 485 |
| `improver/workflow.ts` | production | 227 | 227 |
| `inbox-sorter/inspect-inbox.ts` | production | 40 | 40 |
| `inbox-sorter/workflow.test.ts` | executable-test | 150 | 133 |
| `inbox-sorter/workflow.ts` | production | 142 | 142 |
| `pr-reviewer/workflow-steps.ts` | production | 260 | 260 |
| `pr-reviewer/workflow.test.ts` | executable-test | 488 | 393 |
| `pr-reviewer/workflow.ts` | production | 114 | 114 |
| `progress-review-publication/workflow.ts` | production | 66 | 66 |
| `progress-reviewer/__fixtures__/autonomous-coding-review.json` | authored-support | 22 | 22 |
| `progress-reviewer/__fixtures__/channel-processing-review.json` | authored-support | 39 | 39 |
| `progress-reviewer/events.ts` | production | 107 | 107 |
| `progress-reviewer/progress-review.ts` | production | 75 | 75 |
| `progress-reviewer/progress-review/action-operation.ts` | production | 25 | 25 |
| `progress-reviewer/progress-review/action-writers.ts` | production | 246 | 246 |
| `progress-reviewer/progress-review/actions.ts` | production | 80 | 80 |
| `progress-reviewer/progress-review/agent-output-schema.ts` | production | 59 | 59 |
| `progress-reviewer/progress-review/agent-output.ts` | production | 264 | 264 |
| `progress-reviewer/progress-review/agent-packet-types.ts` | production | 42 | 42 |
| `progress-reviewer/progress-review/agent-packet.ts` | production | 253 | 253 |
| `progress-reviewer/progress-review/agent-step-output.ts` | production | 128 | 128 |
| `progress-reviewer/progress-review/artifact-evidence.ts` | production | 138 | 138 |
| `progress-reviewer/progress-review/artifact.test.ts` | executable-test | 132 | 132 |
| `progress-reviewer/progress-review/artifact.ts` | production | 37 | 37 |
| `progress-reviewer/progress-review/canonical-state-evidence.test.ts` | executable-test | 91 | 91 |
| `progress-reviewer/progress-review/canonical-state-evidence.ts` | production | 102 | 102 |
| `progress-reviewer/progress-review/collect.ts` | production | 285 | 285 |
| `progress-reviewer/progress-review/constants.ts` | production | 29 | 29 |
| `progress-reviewer/progress-review/event-evidence-daemon-state.test.ts` | executable-test | 104 | 104 |
| `progress-reviewer/progress-review/event-evidence-journal-backfill.test.ts` | executable-test | 146 | 146 |
| `progress-reviewer/progress-review/event-evidence-test-support.ts` | authored-support | 182 | 182 |
| `progress-reviewer/progress-review/event-evidence.ts` | production | 295 | 295 |
| `progress-reviewer/progress-review/git-evidence.ts` | production | 206 | 206 |
| `progress-reviewer/progress-review/internal-types.ts` | production | 113 | 113 |
| `progress-reviewer/progress-review/operator-evidence.ts` | production | 253 | 253 |
| `progress-reviewer/progress-review/proposal-resolution.test.ts` | executable-test | 95 | 95 |
| `progress-reviewer/progress-review/pruned-evidence.ts` | production | 201 | 201 |
| `progress-reviewer/progress-review/pruned-run-evidence.test.ts` | executable-test | 215 | 215 |
| `progress-reviewer/progress-review/pruned-run-evidence.ts` | production | 103 | 103 |
| `progress-reviewer/progress-review/review-types.ts` | production | 127 | 127 |
| `progress-reviewer/progress-review/run-evidence.ts` | production | 263 | 263 |
| `progress-reviewer/progress-review/run-id.ts` | production | 9 | 9 |
| `progress-reviewer/progress-review/task-evidence.ts` | production | 145 | 145 |
| `progress-reviewer/progress-review/task-status.ts` | production | 23 | 23 |
| `progress-reviewer/progress-review/trigger-target.ts` | production | 204 | 204 |
| `progress-reviewer/progress-review/types.ts` | production | 255 | 255 |
| `progress-reviewer/semantic-input-state.ts` | production | 83 | 83 |
| `progress-reviewer/semantic-input.test.ts` | executable-test | 165 | 165 |
| `progress-reviewer/semantic-input.ts` | production | 187 | 187 |
| `progress-reviewer/semantic-publication.test.ts` | executable-test | 313 | 313 |
| `progress-reviewer/semantic-publication.ts` | production | 117 | 117 |
| `progress-reviewer/workflow-citation-correction.test.ts` | executable-test | 236 | 216 |
| `progress-reviewer/workflow-evidence-integrity.test.ts` | executable-test | 168 | 152 |
| `progress-reviewer/workflow-output-schema.ts` | production | 111 | 111 |
| `progress-reviewer/workflow-steps.ts` | production | 273 | 273 |
| `progress-reviewer/workflow.test-helpers.ts` | authored-support | 343 | 340 |
| `progress-reviewer/workflow.test.ts` | executable-test | 3047 | 2906 |
| `progress-reviewer/workflow.ts` | production | 128 | 128 |
| `publication-resource-isolation.test.ts` | executable-test | 92 | 30 |
| `repo-ai-checks/blocking-operations.ts` | production | 87 | 87 |
| `repo-ai-checks/workflow-contracts.ts` | production | 251 | 251 |
| `repo-ai-checks/workflow-results.ts` | production | 192 | 192 |
| `repo-ai-checks/workflow.test.ts` | executable-test | 347 | 291 |
| `repo-ai-checks/workflow.ts` | production | 211 | 211 |
| `research-retry/blocking-operations.ts` | production | 88 | 88 |
| `research-retry/candidates.ts` | production | 53 | 53 |
| `research-retry/precondition.ts` | production | 264 | 264 |
| `research-retry/runtime-detect.ts` | production | 39 | 39 |
| `research-retry/shadow-review.ts` | production | 120 | 120 |
| `research-retry/trigger.ts` | production | 41 | 41 |
| `research-retry/workflow.test.ts` | executable-test | 359 | 330 |
| `research-retry/workflow.ts` | production | 124 | 124 |
| `runtime-health-auditor/daemon-control-health.ts` | production | 35 | 35 |
| `runtime-health-auditor/runtime-health-audit-control-coverage-gates.ts` | production | 189 | 189 |
| `runtime-health-auditor/runtime-health-audit-control-coverage-integrity.test.ts` | executable-test | 237 | 237 |
| `runtime-health-auditor/runtime-health-audit-control-coverage-test-context.ts` | authored-support | 97 | 97 |
| `runtime-health-auditor/runtime-health-audit-control-coverage-test-support.ts` | authored-support | 538 | 538 |
| `runtime-health-auditor/runtime-health-audit-control-coverage.test.ts` | executable-test | 182 | 182 |
| `runtime-health-auditor/runtime-health-audit-control-coverage.ts` | production | 265 | 265 |
| `runtime-health-auditor/runtime-health-audit-dead-letters.ts` | production | 58 | 58 |
| `runtime-health-auditor/runtime-health-audit-evidence.ts` | production | 185 | 185 |
| `runtime-health-auditor/runtime-health-audit-finalize.ts` | production | 56 | 56 |
| `runtime-health-auditor/runtime-health-audit-interruptions.test.ts` | executable-test | 191 | 191 |
| `runtime-health-auditor/runtime-health-audit-model.ts` | production | 199 | 199 |
| `runtime-health-auditor/runtime-health-audit-module-logs.ts` | production | 154 | 154 |
| `runtime-health-auditor/runtime-health-audit-operator-evidence.test.ts` | executable-test | 141 | 141 |
| `runtime-health-auditor/runtime-health-audit-operator-runtime.ts` | production | 121 | 121 |
| `runtime-health-auditor/runtime-health-audit-runs.ts` | production | 195 | 195 |
| `runtime-health-auditor/runtime-health-audit-test-context.ts` | authored-support | 187 | 187 |
| `runtime-health-auditor/runtime-health-audit.test.ts` | executable-test | 309 | 309 |
| `runtime-health-auditor/runtime-health-audit.ts` | production | 142 | 142 |
| `runtime-health-auditor/workflow.ts` | production | 114 | 114 |
| `scope-improvement-actions/workflow.ts` | production | 221 | 221 |
| `scope-improvement-onboarding/workflow.ts` | production | 131 | 131 |
| `scope-improvement-publication/workflow.ts` | production | 66 | 66 |
| `scope-improver/events.ts` | production | 94 | 94 |
| `scope-improver/preparation-steps.ts` | production | 152 | 152 |
| `scope-improver/scope-fingerprint.test.ts` | executable-test | 111 | 111 |
| `scope-improver/scope-fingerprint.ts` | production | 154 | 154 |
| `scope-improver/scope-improvement-actions.test.ts` | executable-test | 229 | 229 |
| `scope-improver/scope-improvement-actions.ts` | production | 228 | 228 |
| `scope-improver/scope-improvement-authority.test.ts` | executable-test | 83 | 83 |
| `scope-improver/scope-improvement-authority.ts` | production | 81 | 81 |
| `scope-improver/scope-improvement-candidates.ts` | production | 90 | 90 |
| `scope-improver/scope-improvement-consumption.ts` | production | 48 | 48 |
| `scope-improver/scope-improvement-discovery.ts` | production | 254 | 254 |
| `scope-improver/scope-improvement-publication.test.ts` | executable-test | 241 | 241 |
| `scope-improver/scope-improvement-publication.ts` | production | 136 | 136 |
| `scope-improver/scope-improvement-recommendation.ts` | production | 83 | 83 |
| `scope-improver/scope-improvement-state.ts` | production | 311 | 311 |
| `scope-improver/scope-improvement-types.ts` | production | 185 | 185 |
| `scope-improver/scope-improvement.ts` | production | 5 | 5 |
| `scope-improver/scope-policy-test-support.ts` | authored-support | 40 | 40 |
| `scope-improver/semantic-request.test.ts` | executable-test | 80 | 80 |
| `scope-improver/semantic-request.ts` | production | 77 | 77 |
| `scope-improver/triggers.ts` | production | 18 | 18 |
| `scope-improver/workflow-semantic-consumption.test.ts` | executable-test | 311 | 311 |
| `scope-improver/workflow.test-helpers.ts` | authored-support | 64 | 64 |
| `scope-improver/workflow.test.ts` | executable-test | 585 | 585 |
| `scope-improver/workflow.ts` | production | 187 | 187 |
| `security-review/blocking-operations.ts` | production | 66 | 66 |
| `security-review/candidate-steps.ts` | production | 69 | 69 |
| `security-review/due-check.test.ts` | executable-test | 310 | 310 |
| `security-review/due-check.ts` | production | 516 | 516 |
| `security-review/finding-steps.ts` | production | 182 | 182 |
| `security-review/output-schemas.ts` | production | 80 | 80 |
| `security-review/preflight-step.ts` | production | 87 | 87 |
| `security-review/security-review-candidate-selection.ts` | production | 270 | 270 |
| `security-review/security-review-candidates.ts` | production | 3 | 3 |
| `security-review/security-review-file-scan.ts` | production | 165 | 165 |
| `security-review/security-review-output.ts` | production | 123 | 123 |
| `security-review/security-review-scan-model.ts` | production | 234 | 234 |
| `security-review/security-review-task-identity.ts` | production | 164 | 164 |
| `security-review/security-review-tasks.ts` | production | 238 | 238 |
| `security-review/security-review.ts` | production | 3 | 3 |
| `security-review/workflow-finding-run.test-cases.ts` | executable-test | 300 | 296 |
| `security-review/workflow-run.test-cases.ts` | executable-test | 141 | 131 |
| `security-review/workflow-scan.test-cases.ts` | executable-test | 270 | 270 |
| `security-review/workflow-task-identity.test-cases.ts` | executable-test | 177 | 176 |
| `security-review/workflow-task.test-cases.ts` | executable-test | 247 | 215 |
| `security-review/workflow-test-fixture.ts` | authored-support | 201 | 201 |
| `security-review/workflow.test.ts` | executable-test | 90 | 90 |
| `security-review/workflow.ts` | production | 94 | 94 |
