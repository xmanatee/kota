---
id: task-export-agent-native-security-telemetry-through-the
title: Export agent-native security telemetry through the tracing module
status: done
priority: p2
area: modules
summary: Bridge KOTA's existing tool telemetry, guardrail decisions, approval events, and injection-defense assessments into bounded OTLP log records so operators can triage autonomous coding-agent activity without reconstructing raw transcripts.
created_at: 2026-05-17T13:42:30.451Z
updated_at: 2026-05-17T13:58:27.000Z
---

## Problem

KOTA now records strong local evidence for autonomous agent behavior: workflow
spans, per-step artifacts, per-tool-call telemetry, guardrail audit entries,
approval events, and injection-defense assessments. Those records are still
split across file artifacts, JSONL audit storage, and the event bus. An
operator or security triage process that wants to answer "what did the agent
do, what was blocked or approved, and why was the action allowed?" must stitch
those surfaces together manually.

The tracing module exports workflow spans and metrics, but it does not export
agent-native security logs for tool execution, guardrail decisions, approval
requests/resolutions, MCP tool usage, or injection-defense assessments. That
leaves KOTA short of the observability pattern now expected for deployed coding
agents: structured telemetry that explains agent intent, tool activity, and
policy decisions without exposing raw prompts, tool inputs, tool outputs, or
secrets.

## Desired Outcome

The `tracing` module emits bounded OpenTelemetry log records for the existing
agent-security signals that KOTA already produces. When `tracing.endpoint` is
configured, the same module that owns workflow spans also exports records for:

- tool-call summaries from agent-step tool telemetry artifacts,
- `guardrail.assessed` decisions,
- `approval.requested` / `approval.resolved` events,
- `injection.defense.assessed` events, and
- MCP tool calls as identified by the existing `mcp__<server>__<tool>` naming
  convention and tool telemetry records.

Each record should carry correlation fields such as project id when available,
workflow name, run id, step id, session id when available, tool name, risk,
policy, approval outcome, injection verdict, duration, success/failure, and
payload byte counts. These logs are for operator/security triage only; they do
not become agent-facing context.

## Constraints

- Keep ownership in the `tracing` module. Do not add a second observability
  exporter, audit store, or security-monitor workflow.
- Use the existing event bus and existing tool-telemetry artifacts. Add typed
  events only where a required fact is truly unavailable.
- Do not export raw user prompts, chain-of-thought, tool inputs, tool outputs,
  file contents, network payloads, or secrets. Store only bounded metadata and
  explicit omission/truncation flags.
- Preserve the current guardrails-audit JSONL store and run artifacts; OTLP
  logs are an export path, not a replacement source of truth.
- When tracing is not configured, the feature must have zero exporter setup and
  no new background work.
- Keep project scoping honest. Do not invent nullable `projectId` fallbacks for
  daemon-wide events that do not carry project attribution yet; either omit the
  attribute or add project-scoped event emission at the correct boundary.

## Done When

- The tracing module initializes an OTLP log exporter alongside its current
  trace and metric exporters when tracing is configured.
- Guardrail, approval, injection-defense, and agent-step tool telemetry signals
  produce bounded log records with stable attribute names and run/session
  correlation where available.
- Agent-step completion exports one log record per bounded tool-call telemetry
  entry without reading or emitting raw transcript content.
- MCP tool usage is identifiable in exported records without adding an MCP-only
  telemetry surface.
- Tests cover exporter-disabled no-op behavior, exporter-enabled log emission
  for each signal family, bounded omission of raw payloads, and project/session
  correlation behavior for daemon-wide versus project-scoped events.
- Tracing module guidance mentions the log-export boundary at a high level
  without cataloging every attribute.

## Source / Intent

Explorer run `2026-05-17T13-39-04-911Z-explorer-o343ni` reviewed an empty
actionable queue. The strategic blocked alternatives were all operator-capture
gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal: OpenAI's May 8, 2026 post "Running Codex safely at OpenAI"
describes deployed coding-agent controls around sandboxing, approval policy,
managed network policy, credentials, rules, and agent-native telemetry. The
load-bearing local pattern is not another sandbox or approval system; KOTA
already has tool-risk guardrails, approvals, injection-defense, run artifacts,
and workflow tracing. The remaining gap is exporting those existing decisions
as agent-aware security telemetry so operators can triage activity from one
structured log stream.

Local inspection found:

- `src/modules/tracing/` exports workflow spans and metrics but not OTLP logs.
- `src/core/events/event-bus-types.ts` already declares guardrail and approval
  events.
- `src/modules/injection-defense/events.ts` declares injection assessment
  events.
- `src/core/workflow/steps/step-executor-agent-telemetry.ts` writes bounded
  per-tool-call artifacts that avoid raw payloads.
- `data/tasks/done/task-record-per-tool-call-telemetry-in-agent-step-artifacts.md`
  recently completed the bounded call-level artifact this task should reuse.

## Initiative

Agent observability and safety: KOTA should make autonomous coding-agent
activity explainable through typed operator telemetry without weakening the
artifact-only critic boundary or exposing sensitive content.

## Acceptance Evidence

- Focused test transcript for tracing log export, for example
  `pnpm test src/modules/tracing/tracer.test.ts src/modules/tracing/metrics.test.ts`.
- A fixture or fake OTLP exporter assertion showing guardrail, approval,
  injection-defense, and tool-call records with correlation attributes.
- Diff review shows no raw prompt, chain-of-thought, tool input, tool output,
  or secret-bearing payload is exported.
