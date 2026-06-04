---
id: task-add-retention-redaction-and-provenance-policy
title: Add retention redaction and provenance policy
status: backlog
priority: p1
area: core
summary: Add a cross-cutting policy for event/run/decision/log retention, redaction, provenance, and exported client projections so durable automation evidence stays useful without leaking secrets or sensitive content.
depends_on: [task-add-durable-event-envelope-and-journal, task-add-module-setup-and-auth-requirement-protocol, task-add-persisted-owner-confirmed-action-protocol, task-add-scope-policy-inheritance-protocol]
created_at: 2026-06-03T15:51:25.157Z
updated_at: 2026-06-03T15:51:25.157Z
---

## Problem

The architecture direction adds more durable evidence: event journals,
workflow runs, DLQ items, owner decisions, setup requirements, simulation
reports, logs, traces, and client projections. KOTA already has scattered
redaction rules, tracing security-log limits, approval/owner-question
projection rules, and run artifact pruning, but it lacks one policy that says
what is retained, what is redacted, who/what produced an artifact, and how
clients and agents may consume it.

Without this, durable automation evidence can either be too thin to audit or
too rich and leak prompts, message contents, credentials, PII, provider tokens,
or private planning context.

## Desired Outcome

Add a cross-cutting retention, redaction, and provenance policy. The policy
should apply consistently to event envelopes/journals, workflow run records,
owner decisions, approvals, DLQ items, module setup state, simulation reports,
logs/traces, and client API projections.

The policy should define:

- Data classes and sensitivity levels.
- Retention periods by scope, artifact type, and state.
- Redaction profiles for internal storage, agent context, daemon API, CLI/web
  clients, exported reports, and logs/traces.
- Provenance fields for producer module, action/tool/workflow/agent/session,
  source event, owner decision, and transformed artifact.
- Tamper/overwrite posture for append-only records.
- Deletion/pruning behavior and how references are represented after payload
  expiry.

## Constraints

- Do not put raw secrets, credentials, API keys, provider refresh tokens,
  chain-of-thought, or unbounded tool I/O in durable operator-visible records.
- Do not solve privacy with vague prompt instructions. Enforce redaction and
  retention at typed storage/API boundaries.
- Do not make evidence useless. Redacted records still need ids, timestamps,
  source, scope, status, error class, and enough provenance to debug behavior.
- Keep scope policy and module manifest data as inputs to this policy rather
  than duplicating their declarations.
- Avoid platform-specific client rules. Clients consume a projected data shape
  from the daemon.

## Done When

- A typed policy model exists for artifact type, data class, retention,
  redaction profile, provenance fields, and projection target.
- Event journal, workflow run summaries, DLQ items, owner decisions, approvals,
  setup/auth status, and tracing/log exports use the policy or explicitly
  declare why they are out of scope.
- Daemon APIs return redacted projections by target and never expose secret
  values in client-visible JSON.
- Tests cover redaction for secrets/PII/provider payloads, retention pruning,
  provenance preservation after pruning, client projection differences, and
  append-only/tamper posture where applicable.
- Documentation or local `AGENTS.md` guidance identifies the canonical policy
  boundary so new modules do not invent private redaction schemes.

## Source / Intent

Owner request on 2026-06-03 calls for persisted and non-persisted data,
protocolized auth/config, channel signals, progress reviews over logs and
artifacts, and clear contracts rather than prompt-only discipline. Local
investigation found multiple partial mechanisms: approval/owner-question
queues, tracing security log guidance, in-memory event ring buffer, run
artifacts, and module setup docs.

Research references:

- OWASP logging guidance warns against logging data unless legally sanctioned
  and calls out sanitization/sensitive-data concerns:
  `https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html`
- W3C PROV defines a common vocabulary for provenance:
  `https://www.w3.org/TR/prov-overview/`
- OpenTelemetry context propagation warns that propagated trace/baggage data
  can reveal sensitive information:
  `https://opentelemetry.io/docs/concepts/context-propagation/`

## Initiative

Useful evidence without leakage: KOTA can keep durable automation history while
respecting secrets, private content, and scope-specific retention.

## Acceptance Evidence

- Unit tests for redaction/projection and retention pruning across event,
  run, DLQ, owner-decision, approval, and setup artifacts.
- Daemon API fixture proving client-visible JSON omits secret and sensitive
  payload values while preserving provenance ids.
- A run artifact showing an event-to-workflow-to-owner-decision chain after
  redaction and retention policy application.
