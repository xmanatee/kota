---
id: task-record-agent-step-sandbox-capability-snapshots-in-workflow-artifacts
title: Record agent-step sandbox capability snapshots in workflow artifacts
status: done
priority: p2
area: core
summary: Persist the resolved agent harness capability and sandbox boundary for every workflow agent step so ordinary autonomous run artifacts explain which controls were active, not only parity runs.
created_at: 2026-05-18T02:26:21Z
updated_at: 2026-05-18T02:37:17Z
---

## Problem

KOTA now records harness capability snapshots in harness-parity artifacts, but
ordinary workflow agent steps still only return the resolved harness and model
from `executeAgentStep`. The per-step run artifacts capture prompts,
transcripts, tool telemetry, write-scope violations, and retry outcomes, but
they do not persist the resolved harness control boundary that shaped the run:
whether KOTA or a native CLI controlled tools, which neutral guardrail options
were unsupported, whether owner questions were available, whether message
streaming was emitted, and what local readiness or sandbox facts were observed
before launch.

That means the normal autonomous run record can prove what the agent did, but
not which sandbox or tool-control boundary was actually active when it did it.
This is especially weak for native CLI harnesses, where KOTA intentionally
routes or rejects neutral control options rather than pretending it owns the
provider's sandbox.

## Desired Outcome

Every workflow agent step writes a small structured capability artifact beside
the existing step artifacts before the harness is launched. The artifact should
let an operator or critic inspect a normal builder, critic, explorer, or
mention-response run and see the resolved harness capability boundary without
opening adapter source or relying on a separate parity run.

The same source of truth should power this artifact and harness-parity
snapshots. If the shared helper has to move out of `src/modules/harness-parity/`
so core workflow execution can use it without importing a module, move the
neutral snapshot logic to the agent-harness boundary and keep harness-parity as
a consumer.

## Constraints

- Do not create a second hand-written harness capability catalog. Derive the
  snapshot from the resolved `AgentHarness` declaration and its readiness probe.
- Keep readiness local and non-networked. Artifact capture must not make a
  provider call before the step starts.
- Write the artifact before harness launch so setup or preflight failures still
  leave the resolved boundary visible.
- Do not weaken the apply-or-reject rule for unsupported neutral options.
  Native harnesses that cannot honor KOTA tool-control options must still fail
  loudly when callers pass unsupported options.
- Do not export raw prompts, tool inputs, tool outputs, secrets, or adapter
  private config through this artifact.
- Keep exact artifact field names in code and tests, not in durable docs.

## Done When

- Workflow agent steps write a deterministic
  `steps/<step-id>.harness-capability.json` or equivalent artifact containing
  the resolved harness name, `toolControl`, owner-question support, stream
  support, supported hook kinds, unsupported run options, and local readiness
  summary when available.
- Harness-parity snapshots and workflow agent-step snapshots share one
  capability-snapshot implementation instead of drifting in parallel.
- The artifact is written even when a native harness rejects unsupported
  options or a readiness probe reports an unavailable local runtime.
- Tests cover a KOTA-controlled fake harness, a native fake harness with
  unsupported tool-control options, and a readiness probe that reports sandbox
  or local-runtime facts without making provider network calls.
- Existing workflow run output remains backward compatible: step results still
  expose the resolved harness/model as they do today, and tool telemetry
  artifacts keep their current shape.

## Source / Intent

Explorer run `2026-05-18T02-24-26-682Z-explorer-kt7y2t` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Record agent-step sandbox capability snapshots in workflow artifacts" --state ready --area core --priority p2 --summary "Persist the resolved agent harness capability and sandbox boundary for every workflow agent step so ordinary autonomous run artifacts explain which controls were active, not only parity runs."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`. This file follows the normalized task schema manually.

External signal checked:

- `https://openai.com/news/security/` now lists OpenAI's May 13, 2026 Codex
  Windows sandbox engineering post alongside the May 8 Codex deployment-safety
  post and the May 13 TanStack supply-chain response.
- `https://openai.com/index/building-codex-windows-sandbox/` explains that
  Codex's useful default posture depends on OS-enforced constraints: broad
  reads, writes only inside the workspace and configured writable roots, and
  no network unless requested. The Windows implementation required explicit
  setup, dedicated sandbox principals, firewall rules, and a command-runner
  boundary so the harness can prove what is enforced.

Local inspection found:

- `src/modules/harness-parity/capability-snapshot.ts` already derives a typed
  capability snapshot from `AgentHarness`.
- `src/core/workflow/steps/step-executor-agent.ts` resolves the harness and
  returns its name/model, but does not write a capability artifact for normal
  workflow runs.
- `src/core/workflow/steps/step-executor-agent-telemetry.ts` writes bounded
  tool telemetry, proving the step artifact pattern already exists without raw
  prompt or tool payload export.
- Recent tasks already closed the broader gaps around parity capability
  artifacts, progress-resetting idle timeouts, MCP result variants, GitHub
  mention ingress, daemon config reload events, GUI coordinate contracts, and
  pnpm supply-chain hardening. The remaining nonduplicative gap is making the
  ordinary workflow run artifact explain the sandbox/control boundary.

## Initiative

Autonomous run auditability: ordinary workflow artifacts should explain which
agent harness controls and sandbox assumptions produced a run, not just what
the run output was.

## Acceptance Evidence

- Focused test transcript for workflow agent-step artifact writing and shared
  capability snapshot behavior, for example
  `pnpm test src/core/workflow/steps/step-executor-agent.test.ts src/modules/harness-parity/runner.test.ts`.
- A run artifact fixture or temporary test run showing
  `steps/<step-id>.harness-capability.json` for both a KOTA-controlled and a
  native-style harness.
- Diff review shows the artifact contains bounded capability/readiness metadata
  only, with no raw prompt, tool input, tool output, secret, or provider-native
  private config.

## Completion Evidence

- `.kota/runs/2026-05-18T02-28-26-837Z-builder-rcjgrk/focused-test-transcript.txt`
  shows the focused workflow-step, harness-parity, and harness-runner tests
  passing.
- `.kota/runs/2026-05-18T02-28-26-837Z-builder-rcjgrk/typecheck-transcript.txt`
  shows `pnpm typecheck` passing.
- `.kota/runs/2026-05-18T02-28-26-837Z-builder-rcjgrk/lint-transcript.txt`
  shows `pnpm lint` passing.
