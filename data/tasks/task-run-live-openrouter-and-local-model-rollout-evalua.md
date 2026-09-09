---
status: blocked
priority: p1
depends_on: [task-extend-harness-parity-and-eval-harness-with-model-, task-add-scaffolded-weak-and-local-model-agent-mode]
---
# Run live OpenRouter and local model rollout evaluation

## Problem

After the provider and harness parity work lands, KOTA still needs an evidence
run before changing defaults or recommending OpenRouter/local models. Public
benchmarks are not enough because they measure different harnesses, prompts,
tools, and environments. The owner wants practical performance in KOTA, not a
model leaderboard summary.

## Desired Outcome

KOTA runs the completed model matrix against Codex baselines and records a
support-tier decision. The result names which models are supported for capable,
balanced, fast, weak/local scaffolded, and rejected use; it also names the
remaining blockers for models that are close but not ready.

## Constraints

- Do not promote any OpenRouter or local model to a recommended default unless
  the matrix evidence meets the acceptance threshold.
- The capable replacement candidate must reach at least 90% of Codex `pass^k`
  on the selected KOTA scenario suite and have no P0 feature-parity failures.
- Secondary candidates can be marked supported for narrower tiers only when
  the report names the task class, pass^k, cost, latency, and feature limits.
- If `OPENROUTER_API_KEY` or local runtime prerequisites are absent, record a
  preflight skip and keep the task open; a skip is not rollout evidence.
- Keep the final decision in the task result and run artifact. Do not create a
  parallel benchmark catalog or external leaderboard doc.

## Done When

- The matrix includes Codex/GPT-5.5 baseline rows and candidate rows for at
  least GLM-5.2, Kimi K2.7 Code, DeepSeek V4 Pro/Flash, Qwen 3.7 Plus, MiniMax
  M3, MiMo V2.5, and one local or local-like weak model route.
- Each candidate has pass@k, pass^k, cost, latency, token usage, turn count,
  tool count, approval count, context-retrieval diagnostics, trajectory
  diagnostics, and verifier output recorded.
- The rollout decision marks each candidate as `supported`, `experimental`,
  `scaffold-only`, or `rejected`.
- Presets or operator guidance are updated only for `supported` candidates.
- The task result explicitly states whether KOTA can currently run without
  Codex/Claude for the selected task classes and what remains before broader
  replacement.

## Source / Intent

The owner asked to run candidates in parallel with Codex, look at real
performance, tune directions for weaker models, and reach a future state where
KOTA can be run without Codex or Claude when evidence supports it. This task is
the empirical decision point after the enabling work is complete.

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `.kota/runs/<run-id>/` contains the live model-matrix artifacts, preflight
  records, per-scenario transcripts, verification output, aggregate report, and
  support-tier decision.
- `pnpm run validate-tasks` passes after the task records its outcome or moves
  follow-up blockers into the queue.
- If supported presets are changed, `pnpm run test:preset-parity` passes or
  records valid auth/runtime skips for every affected preset.

## Result — 2026-09-09 preflight skip

Outcome: preflight skip; rollout decision deferred. No live inference, scenario,
fixture, or verifier ran. No candidate is promoted or rejected on this evidence.
KOTA's ability to replace Codex/Claude for any task class remains unestablished
by this run.

The process has no OPENROUTER_API_KEY. The active filesystem policy denies
scope secret files, so the scope resolver was not invoked. This does not
contradict the historical September 8 authentication success or establish that
the host lacks a key. Both default local model-list endpoints (Ollama on 11434
and LM Studio on 1234) returned fetch failure with EPERM. This establishes an
execution-context restriction, not an absent server or an incapable model.

rollout-preflight.json records the timestamped observations and the shipped
candidate set, including every required OpenRouter candidate. The canonical
catalog freshness validator accepted the June 26 metadata; current provider
availability was not checked. No local model was discovered or guessed.
All performance metrics and support tiers are unavailable, rather than zero
or fabricated classifications.

The task remains unfinished in the active queue, marked blocked under the
builder's required lifecycle rule. This records the concrete external
precondition while preserving the task's intent that a skip cannot count as
completion. Production presets and operator recommendations are unchanged.

Resume in a runtime-authorized evaluation context with access to the existing
OpenRouter credential, native Codex baseline execution, and an identified local
model endpoint. Use the shared matrix path with compatible provider/harness
routing, paired scenarios and eval fixtures, sequential repeats, and comparable
resource/configuration evidence. Record all requested metrics and verifier
artifacts before assigning supported, experimental, scaffold-only, or rejected
tiers. A capable replacement still requires at least 90% of baseline pass^k and
no P0 feature-parity failures; narrower support requires measured task-class
consistency, cost, latency, and feature limits.

Evidence: builder run 2026-09-09T15-01-01-382Z-builder-4endrv,
runtime agent artifacts rollout-preflight.mjs, rollout-preflight.json, and
rollout-decision.md. Task integrity validation is retained in validate-tasks.txt.

## Blocked on

kind: operator-capture
path: .kota/runs/2026-09-09T15-01-01-382Z-builder-4endrv/live-model-rollout-readiness/transcript.txt
description: Capture redacted successful readiness evidence from the intended evaluation context showing scoped OpenRouter authentication, native Codex/GPT-5.5 execution, and a reachable identified local model endpoint. Do not include credentials. This unblocks execution of the live matrix; readiness alone is not rollout evidence.
A runtime-authorized execution context that can resolve the existing
OpenRouter credential, execute the Codex/GPT-5.5 baseline, and reach an
identified local model endpoint. This sandbox has no environment key, denies
scope credential files, and denies both local endpoint probes with EPERM.
Once access is available, reopen this same task and execute the live matrix;
the preflight skip does not satisfy any rollout acceptance threshold.