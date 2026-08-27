---
status: done
---

# Guard tracing exports against provider request payload leakage

## Problem

KOTA's tracing module explicitly says logs and traces must not include raw
prompts, tool inputs, tool outputs, file contents, network payloads, or
secrets. Current security-log coverage exercises bounded tool telemetry, but
there is no focused regression canary that proves model-provider request and
response payloads cannot leak through OpenTelemetry spans, security logs,
model-client debug paths, or enrichment error reporting.

The external trigger is Codex `rust-v0.142.5`, released 2026-07-01, which fixed
full Responses WebSocket request payloads being written to trace logs. KOTA does
not need Codex's exact patch, but the failure mode is directly relevant because
KOTA now has first-class tracing, provider-payload effect metadata, OpenAI-
compatible model clients, and multiple agent harnesses.

## Desired Outcome

Add a deterministic provider-payload leak guard for KOTA observability paths.
The guard should prove that raw model-provider request and response contents are
omitted from trace/log exports while retaining safe metadata such as model id,
provider id, byte counts, omitted flags, status, duration, token counts, cost,
and failure class.

## Constraints

- Do not remove useful operator observability to make the test pass. Preserve
  metadata needed for debugging and incident response.
- Do not persist raw prompts, tool schemas, tool inputs, tool outputs,
  reasoning blocks, provider request bodies, provider response bodies, API keys,
  bearer tokens, or Authorization headers in OTLP traces/security logs/debug
  messages.
- Keep provider-specific handling at the model-client or harness adapter
  boundary; do not add provider-payload knowledge to unrelated core tracing
  code unless the event contract already carries that data.
- Include negative fixtures with realistic fake payloads and fake credentials,
  but never require live provider credentials.
- Treat run artifacts separately from exported traces/logs: this task guards
  observability export and debug leakage, not every intentional task artifact.

## Done When

- A focused test or fixture sends a model-provider request containing a unique
  fake prompt, tool schema, tool result, reasoning-looking block, fake API key,
  bearer token, and response text through the relevant KOTA model-client or
  agent-harness path.
- The captured OpenTelemetry span payload, security-log OTLP payload, logger
  debug/error calls, and enrichment error paths contain only bounded metadata
  and omission markers for the provider payload.
- The same test fails if a raw provider request body, response body, prompt
  text, reasoning-like content, tool payload, or credential string is exported.
- Existing tracing/security-log tests still prove normal metadata is present
  and useful.

## Source / Intent

Watchlist refresh on 2026-07-01 found
`https://github.com/openai/codex/releases/tag/rust-v0.142.5`. The release notes
say Codex prevented full Responses WebSocket request payloads from being written
to trace logs. KOTA already records a tracing policy in
`src/modules/tracing/AGENTS.md` and marks model-provider prompt/tool/response
payloads as `provider-payload` in `src/modules/model-clients/index.ts`, but no
open task covered a cross-surface regression canary for that exact leak shape.

## Initiative

Provider-payload observability safety.

## Acceptance Evidence

- Focused test transcript for tracing/security-log/model-client leakage
  coverage, with the fake sentinel payload values absent from exported traces,
  security-log OTLP bodies, and logger calls.
- A short result note in this task or the run artifact naming which
  observability paths were covered and which safe metadata fields remain.

## Result

Added a focused provider-payload leak guard covering OpenAI-compatible request
serialization, model-client HTTP failures, workflow span enrichment,
security-log records, OTLP log export JSON, enrichment logger callbacks, and
OTLP export failure callbacks. The retained metadata is limited to model id,
workflow/run/step identifiers, status, duration, autonomy mode, turns, tokens,
cost, session id, tool id/name, byte counts, omission flags, success, duration,
and result content kind.
