---
id: task-report-and-validate-codex-harness-capabilities-tru
title: Report and validate Codex harness capabilities truthfully
status: done
priority: p1
area: client
task_class: Product
summary: Keep native Codex first class while validating workflow requirements early and reporting supported and unsupported controls accurately.
created_at: 2026-08-24T02:13:41.281Z
updated_at: 2026-08-26T02:57:13.816Z
---

## Problem

KOTA's native Codex adapter is a capable first-class harness, but doctor marks
its unsupported neutral options as a passing check, and supervised-mode
remediation recommends passive mode even though this adapter rejects passive.
Incompatible workflow requirements can survive too far into dispatch before
the operator gets a clear explanation.

## Desired Outcome

Keep the single native `codex` adapter and its ChatGPT login, GPT-5.6 routing,
native tools, streaming, isolation, scoped writes, restricted egress, and
cancellation guarantees. Validate requested workflow capabilities before
queueing and report supported, unsupported, and requested-incompatible
capabilities as distinct states.

## Constraints

- Do not remove Codex, replace it with an API-key-only hosted loop, or create a
  second shadow Codex adapter.
- Do not claim KOTA intercepts Codex native shell/tool calls or can provide
  mid-turn KOTA approvals when the CLI does not expose that boundary.
- Reuse the existing harness capability snapshot, `toolControl`, readiness,
  and unsupported-run-option declarations; do not add another catalog.
- Compose owner approval as deterministic workflow steps around native Codex
  execution where mid-turn interception is unavailable.
- Add native resume, structured output, MCP, or other Codex CLI features only
  when their isolation and enforcement are proven end to end.

## Done When

- Workflow validation rejects an incompatible resolved Codex step before it is
  queued or spawned and names the required and missing capability.
- Doctor reports Codex's supported capabilities as ready, intentional limits
  as informational, and only requested incompatibilities as warn/fail.
- No remediation message recommends a mode or control the adapter rejects.
- Existing autonomous coding and Telegram interactive paths continue to run
  through native Codex with ChatGPT-plan authentication.
- Capability reporting is derived from the adapter definition and cannot drift
  into a hand-maintained doctor list.

## Source / Intent

Owner clarification on 2026-08-24: Codex must remain supported. Recheck against
Codex CLI 0.144.1 confirmed native exec, resume, sandbox, structured-output,
streaming, and isolated-config surfaces; the defect is truthful KOTA capability
routing and reporting, not Codex support itself.

## Initiative

First-class, truthful multi-harness operation.

## Acceptance Evidence

- Screened `kota doctor --preset codex --skip-connectivity` transcript at
  `.kota/runs/2026-08-26T04-00-00-000Z-codex-capability-integration/evidence/artifacts/transcript.txt`.
- Native Codex runtime fixture proving autonomous coding, streamed messages,
  scoped writes, cancellation, and ChatGPT-login readiness remain intact.
- Deliberate capability mismatch fixtures that fail before dispatch without
  spawning Codex.
