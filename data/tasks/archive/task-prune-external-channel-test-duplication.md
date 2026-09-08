---
status: done
---

# Prune external channel test duplication

## Scope / Starting Points

Inventory `src/core/channels` and Telegram, Slack, email, webhook, push, and related modules for identity/trust mapping, callbacks, parsing, confirmation, rendering, delivery, retry, fixtures, and copied domain lifecycles.

## Required Changes

- Retain checks for untrusted input, identity binding, authorization mapping, callback integrity, confirmation, message parsing/rendering, delivery effects, retries, and provider limits.
- Delete approval, owner-decision, task, search, and data-result lifecycle matrices already owned below.
- Replace bespoke host fixtures with narrow production adapter ports; keep real provider-shaped boundaries only where they catch a distinct failure.

## Must Not Complete While

Any channel/scenario is unclassified, any channel decides domain lifecycle state, or shared behavior remains copied per provider.

## Done When

The inventory has zero unresolved rows and each retained scenario names a channel-specific trust, parsing, rendering, delivery, retry, or limit failure.

## Acceptance Evidence

Provide the channel/scenario/disposition matrix and before/after executable-test and authored-support LOC.

## Initiative

Child of `task-prune-operator-and-channel-test-duplication`.

## Completion evidence

Implementation prepared in builder run `2026-09-07T13-19-09-613Z-builder-jvb3h3`.
The run directory retains `channel-scenario-disposition-matrix.md`, the before/after
machine-readable inventories, selected test files/logs, and the A2A HTTP probe.
Every original scenario and support fixture is classified; unresolved rows: **0**.

| Measure | Before | After | Delta |
| --- | ---: | ---: | ---: |
| executable-test LOC | 22,914 | 15,667 | -7,247 |
| authored-support LOC | 2,270 | 1,877 | -393 |
| Scenario declarations | 622 | 470 | -152 |

Counts use physical lines, including comments and embedded test setup. Separate
fixture/support files are counted as authored support; run artifacts are excluded.

| Channel / owner | Disposition |
| --- | --- |
| Core channel protocol | Delete fixture-only discriminated-union assertions; strict types and daemon startup owner remain authoritative. |
| Telegram | Retain chat/scope identity, callback receipts, owner-question reply mapping, parsing, notification rendering, Bot API limits/recovery and distinct daemon journeys. Delete copied search/data-result matrices, scheduler transitions and inbound routing decisions. Consolidate readiness/notification scenarios around typed production adapter ports. Remove the duplicate status daemon journey and handwritten domain routes; the interactive daemon journey uses the production channel, DaemonControlClient and scopes handler. |
| Slack interactive | Replace seven socket-backed command matrices with direct parsing/client/delivery checks. Keep Socket Mode admission, reviewed callback binding, connection recovery and session routing. Narrow startup and command ports. |
| Slack / email / outbound webhook / Expo push | Keep provider payloads, credentials, filters, delivery effects and limits. Use production loader for Slack, email and push activation; narrow outbound webhook subscription ports. Shared retry decisions remain in notification. |
| Inbound webhook | Keep HMAC/body validation, source parsing/precedence/continuity and autonomy rejection; share one narrow HTTP/session fixture and load dynamic routes with the production loader. |
| A2A / ACP | Keep protocol decoding, tenant/session binding, callback credentials/limits, safe review projections, framing and delivery state. A2A fixtures use the production HTTP request handler rather than copied routing/auth logic. |
| GitHub webhook | Keep HMAC, mention/actor/fork/scope normalization and credential rejection through narrow adapter ports; remove catalog assertions. |
| Shared inbound-signals / notification / reference workflow | Retain routing, HTTP retry and confirmed-action composition at their owners. Delete stale handwritten inbound daemon-client mapping coverage superseded by generated bindings. |

Prior implementation validation (before repair attempt 2): production and test TypeScript checks; repository lint; 382 owner tests
across 42 files; 38 ACP protocol tests; five run-local A2A production-handler probes
(public card, missing bearer, rejected POST query token, authorized JSON-RPC, SSE
framing). The fixture review also repaired a vacuous Slack admission oracle and an
outdated Telegram workflow-status projection.

Limit: this sandbox rejects localhost listeners with `listen EPERM`, so socket-based
A2A/daemon/webhook integration suites could not establish a listener here. The A2A
probe instead uses real Node HTTP request/response objects over an in-memory stream
and the production handler. Protected deployment environment files were excluded
from the final selected tests. No live provider delivery was performed.

## Final repair outcome

Removed the synthetic scheduler/broadcast and standalone status-poller scenarios.
Retained Telegram command checks invoke the production handler, broadcast checks
exercise active-chat delivery and scope filtering, and scope fixtures derive their
ports from production adapters. Owner-question callback checks reject missing or
foreign chat/message bindings before domain access and route valid callbacks to
the stored scope. The final inventory classifies all 622 original declarations,
470 retained declarations, and every support file with zero unresolved rows.

## Authorized lifecycle disposition

The task is complete in this isolated writer. Earlier native CLI attempts failed
because dependencies or active workflow mutation authority were unavailable.
Those historical limitations were resolved by the operator/runtime handoff recorded
in `operator-prerequisite-repair.json` under the run directory at
`2026-09-08T15:10:54.848Z`.

That record reports the production repo-task operation checked the active run,
attempt, epoch, task resource, and sandbox against durable authority, then returned
`ok: true`, `fromState: open`, `toState: done` for this task and its archive path.
Direct inspection confirms the archived `status: done` and absence of the active
file. No further lifecycle transition is needed. Canonical publication remains
owned by runtime integration.

## Final validation

After dependency restoration, `repair-lifecycle-validation.md` records successful
production/test typechecking, 43 focused owner tests, task validation, and all five
A2A production-handler probes. The operator handoff records eight additional focused
callback/status tests passing. The latest critic review reports 154 owner tests,
three scope integration scenarios, test typechecking, and task validation passing;
its sole critical finding was the stale completion prose reconciled here.

This documentation repair independently verified the successful handoff record,
terminal task location and metadata, and inventory totals against every current
file's physical LOC. `pnpm validate-tasks --summary` passed with zero errors and
warnings after the edit. Detailed earlier repair attempts remain in run artifacts
as historical evidence; they do not describe the final lifecycle disposition.
