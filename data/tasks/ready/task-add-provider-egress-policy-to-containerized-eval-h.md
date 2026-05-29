---
id: task-add-provider-egress-policy-to-containerized-eval-h
title: Add provider-egress policy to containerized eval-harness runs
status: ready
priority: p2
area: modules
summary: Let containerized eval-harness agent steps reach only configured model-provider endpoints while keeping task code offline, so live-builder fixtures can become gate-eligible without broad internet access.
created_at: 2026-05-29T10:32:22.816Z
updated_at: 2026-05-29T10:32:22.816Z
---

## Problem

KOTA's eval-harness container backend now enforces CPU and memory facts, but it
hardcodes Docker execution with `--network none` in
`src/modules/eval-harness/subprocess-executor.ts`. That is the right default
for fixture task code, but it also cuts off nested live agent steps from their
model provider APIs. The result is a gap between the strict container path and
the live-builder fixtures that most need gate-eligible evidence: host
subprocess runs can reach providers but stay non-gating, while containerized
runs can become gate-eligible but cannot call the configured harness provider.

DeepSWE/Pier surfaces the missing shape clearly: task environments stay
isolated, while the agent runner receives only the network access needed for
its model API calls. KOTA should support that boundary without opening broad
internet access, host networking, package installs, or task-controlled egress.

## Desired Outcome

Containerized eval-harness runs have a typed provider-egress policy that lets
agent steps reach only configured model-provider endpoints while fixture task
code remains offline by default.

The default container policy remains `offline` and continues to use
`--network none`. A deliberate `provider-egress` policy must:

- expose only the minimum egress required by the selected harness/provider;
- record the resolved policy, allowed endpoint set, and enforcement mode in the
  execution-profile artifact;
- fail or mark the run non-gating when the backend cannot enforce the requested
  policy; and
- preserve existing replay, external-call shim, HOME/KOTA_PROJECT_DIR remap,
  resource-profile, timeout, and artifact copy-back behavior.

## Constraints

- Keep the work in `src/modules/eval-harness/` unless a provider-owned type is
  already exposed by the model/harness modules. Do not add a generic core
  sandbox or networking primitive.
- Do not add Docker option passthrough, `--network host`, privileged mode, broad
  volume mounts, or a catch-all internet setting.
- Provider allowlists must be derived from explicit KOTA provider/harness
  configuration or a narrow typed catalog, not from task text or agent output.
- Secrets remain explicit environment inputs. Do not pass the parent
  `process.env` wholesale into the container to make provider calls work.
- Fixture commands and candidate code must not get arbitrary outbound access.
  If the first implementation can only enforce process-level provider egress
  for the KOTA agent runner, say so in the artifact and keep task subprocesses
  offline or non-gating.
- Missing Docker/network enforcement capability must produce typed diagnostics
  and non-gating or rejected preflight output, never a silent downgrade to host
  subprocess execution.

## Done When

- `SubprocessIsolationBackend` or its adjacent config has a strict network
  policy shape with at least `offline` and `provider-egress`.
- The container command builder keeps `offline` as the default and has focused
  tests proving it still emits `--network none`.
- A provider-egress container run can execute a live agent step against a
  configured provider endpoint while fixture task code has no broad internet
  access.
- Execution-profile artifacts record the selected network policy, allowed
  provider endpoint facts, and whether enforcement is gate-eligible.
- Tests cover successful provider-egress command construction, missing or
  unenforceable network policy diagnostics, no parent-env secret leakage, replay
  fixture compatibility, and refusal to silently downgrade to host subprocess.
- Existing eval-harness container, host-subprocess, replay-smoke, and fixture
  loading tests remain green.

## Source / Intent

Explorer run `2026-05-29T10-28-31-478Z-explorer-0lrere` received
`strategicReadyCoverageGap: true` with only one p3 ready task. All surfaced
strategic alternatives were still real operator-capture waits, so the queue
needed a new p0/p1/p2 module-first task rather than another client fan-out or
another live-builder fixture that would immediately join the same blocked
operator-capture tail.

Fresh external signal:

- `https://deepswe.datacurve.ai/` describes DeepSWE as original long-horizon
  coding-agent tasks with isolated environments and behavioral verifiers.
- `https://github.com/datacurve-ai/deep-swe` documents Pier's execution model:
  air-gapped task environments plus per-agent network allowlists so LLM API
  calls can work without giving the task broad outbound internet.

Local overlap check:

- `task-add-an-executable-container-isolation-backend-for-` is done and shipped
  the container execution backend, but the current command still uses
  `--network none` unconditionally.
- Existing blocked live-builder eval tasks need network-enabled provider calls
  for their final pass artifacts, but they do not solve the container
  provider-egress boundary.
- No open ready, backlog, blocked, or inbox item covers provider-only egress
  for gate-eligible containerized eval-harness runs.

## Initiative

Eval-harness reliability: live autonomy evaluation should be able to run inside
an enforceable container profile without giving fixture task code broad network
access or falling back to non-gating host execution.

## Acceptance Evidence

- Focused test transcript for the eval-harness subprocess executor network
  policy behavior, including the default offline path and provider-egress path.
- Eval-harness run artifact under `.kota/runs/<run-id>/` or `.kota/eval-runs/`
  showing a container execution-profile with provider-egress policy facts and
  gate eligibility or a typed non-gating reason.
- Transcript for `pnpm kota eval list` and a targeted `pnpm kota eval run`
  proving existing fixtures still load and replay-compatible fixtures still run.
