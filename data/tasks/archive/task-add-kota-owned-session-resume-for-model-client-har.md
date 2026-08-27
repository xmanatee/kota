---
status: done
---

# Add KOTA-owned session resume for model-client harnesses

## Problem

The `openai-tools` harness rejects `persistSession` and `resumeSessionId`.
That prevents transfer-style `handoff_agent` and longer-running model-client
sessions from matching the behavior expected by KOTA agents and workflows.
Provider-native sessions are not available for most OpenRouter and local
models, so waiting for provider support would leave this parity gap open.

## Desired Outcome

KOTA owns session persistence for model-client harnesses. When a run requests
`persistSession`, KOTA stores the bounded neutral transcript and session
metadata. When a later run supplies `resumeSessionId`, the harness reconstructs
the provider request from KOTA's neutral protocol and continues without
pretending the provider has native state.

## Constraints

- Do not claim provider-native session support. This is KOTA-owned transcript
  persistence and replay.
- Persist only neutral protocol data and redacted metadata needed to continue
  the run. Do not persist raw provider payloads as the resume source of truth.
- Respect existing scope/session ownership and evidence retention rules.
- Keep model-client harnesses stateless at the provider boundary; the session
  store composes messages before each call.
- Continue to reject resume if the stored session references unavailable tools,
  stale MCP declarations, incompatible model capabilities, or missing scope.

## Done When

- `openai-tools` no longer rejects `persistSession` or `resumeSessionId` when
  KOTA-owned resume is available.
- `handoff_agent` transfer mode can pass a persisted model-client harness
  session to a follow-up call.
- Resume records include enough model, provider, cwd/scope, tool, and transcript
  metadata to reject incompatible resumes loudly.
- Token-budget accounting remains per turn after resume.
- Tests cover successful resume, missing session id, incompatible model/provider
  capability, stale MCP/tool declaration, and transfer handoff.

## Source / Intent

The owner wants future runs to work without Codex/Claude. That includes
long-running and delegated work, not only one-shot prompts. The audit found
that model-client harnesses currently reject session persistence even though
KOTA already has neutral message protocols that can support a provider-agnostic
resume layer.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/history-resume.integration.test.ts src/named-agent-handoff.integration.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts` passed in run `2026-06-26T08-24-22-825Z-builder-iai13p`.
- `pnpm test src/modules/openai-tools-agent-harness/adapter.test.ts src/modules/openai-tools-agent-harness/adapter-mcp-shared-runner.test.ts` passed in run `2026-06-26T08-24-22-825Z-builder-iai13p`.
- `pnpm test src/modules/openai-tools-agent-harness/adapter-session-resume.test.ts src/modules/openai-tools-agent-harness/adapter-mcp-shared-runner.test.ts src/modules/openai-tools-agent-harness/adapter.test.ts` passed during post-check repair in run `2026-06-26T08-24-22-825Z-builder-iai13p`.
- `.kota/runs/2026-06-26T08-24-22-825Z-builder-iai13p/openai-tools-resume-transcript.txt` captures the focused persist/resume transcript for the neutral transcript replay scenario.
