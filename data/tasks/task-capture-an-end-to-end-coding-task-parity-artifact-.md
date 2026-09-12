---
status: blocked
priority: p2
---
# Validate end-to-end coding-task parity across registered agent harnesses

## Current Contract

Reopened to implement/probe compatible model/auth routing and run available
coding-capable adapters. Under the September 12 owner waiver, an unavailable
adapter row is an explicit follow-up, not a gate on useful supported-route work.
Keep every adapter accounted for, with paired prompt/trace/diff/verifier evidence
for executed rows and precise credential/capability limits for unrun rows.
No all-adapter parity claim follows from partial results; historical fixed-path
and human-only capture requirements are superseded, not the need for real outcomes.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

The `AgentHarness` registry now exposes at least two adapters
(`claude-agent-sdk`, `thin`) and the CLI now delivers the same expanded
prompt to every adapter. What is not yet proven is that operators can
complete a real coding task end-to-end through KOTA under each harness
without a meaningful capability gap vs running the harness directly.
Without that evidence the "general-purpose coding agent across pluggable
harnesses" claim is aspirational.

## Desired Outcome

A runnable scenarios pack plus captured run-directory artifacts that show
KOTA completing a representative coding task end-to-end under each
registered harness adapter. Each artifact records the prompt, the active
harness and model, the turn-by-turn trace, final diff, and any capability
gap vs running the harness directly (e.g. native `claude-code` CLI or an
equivalent native runner for another adapter). Gaps are named explicitly and
either converted into follow-up tasks or explained why they do not block
"coding-agent parity".

## Constraints

- Use a real coding task whose success can be reduced to an inspectable
  artifact (tests passing, file diff, runtime probe). Do not rely on
  subjective "feels equivalent" judgments.
- Account for every registered harness and pair executed results by scenario
  and model. Equivalent runner-returned artifact locations are accepted.
- Do not introduce a parallel benchmarking framework. Reuse the existing
  `AgentHarness.run` path the CLI already calls.
- Name genuinely missing credentials or non-headless inputs per harness without
  silently skipping the row or blocking work on other supported routes.

## Done When

- A scenarios pack ships with at least one real coding task (code change
  plus verification) that can be run under every registered harness.
- `.kota/runs/<run-id>/harness-parity/` contains paired artifacts per
  harness with prompt, trace summary, diff, and verification result.
- Capability gaps found during the run are either named in a follow-up task
  or explained inline as non-blocking.
- The scenarios pack is reachable from the CLI or an operator-runnable
  script, not only from ad-hoc invocation.

## Source / Intent

Owner direction from the Claude/Codex-alternative inbox work asked KOTA to be
usable as a serious coding-agent wrapper across harnesses, not only as a
Claude-specific automation loop. This task preserves that product claim as an
evidence requirement instead of letting provider-neutral plumbing count as
parity by itself.

## Initiative

General-purpose coding agent parity: KOTA should prove real coding-task
completion through every registered harness, with any harness-specific gap
recorded as an explicit capability boundary.

## Acceptance Evidence

- Operator-runnable harness-parity scenario output under `.kota/runs/` pairs
  each registered harness with prompt, trace summary, diff, and verification.
- Any failed or text-only harness outcome names the capability gap and links to
  a follow-up task or an explicit non-blocking rationale.
- The CLI command that captures the artifact is documented enough for an
  operator to rerun the parity check without ad-hoc setup.

## Plan

Phase 1 — scenarios pack and operator-runnable CLI (this run):

- [done] Ship `src/modules/harness-parity/` with the scenario schema,
  runner, and CLI command. The runner reuses `runAgentHarness` — the
  same entry point the main `kota run` path uses — so paired evidence
  reflects operator reality rather than a parallel benchmarking
  framework.
- [done] Scenario fixture `fix-arithmetic-bug` ships with an `initial/`
  tree and a shell-exit verification predicate (`node test.js`). The
  same prompt and predicate are handed to every registered harness.
- [done] Operator-runnable surface via `kota harness-parity list` /
  `kota harness-parity run`, defaulting to every registered harness and
  every discovered scenario. Artifacts land under
  `.kota/runs/harness-parity-<stamp>/<scenario>/<harness>/`.
- [done] Per-harness artifacts include `prompt.txt`, `trace.txt`,
  `trace-summary.md`, `diff.patch`, `verification.json`, and
  `run-meta.json`. A per-scenario `parity.json` summarizes outcomes
  across harnesses for direct comparison.
- [done] The module `AGENTS.md` documents the scenario layout, artifact
  shape, capability-gap handling, and the explicit non-goals (no
  scoring, no regression gating — eval-harness concerns).

Phase 2 — authorized live capture (still incomplete):

- Use the shipped harness-parity runner from an execution context authorized for
  the current registered harness capabilities. Retain paired artifacts under
  .kota/runs/ with run identity, selected harness/model, prompt, diff and verifier
  outcome. Runtime evidence stays out of source control; retain references in the
  task rather than committing ignored artifact trees.
- The owner has requested live validation. A human need not type each command;
  use existing runtime-authorized execution and credential resolution. Do not
  launch uncontrolled nested agents, expose credentials or bypass isolation.
- A missing authorized capability is a concrete block, not proof the harness is
  incapable. Record a capability gap separately from a provider failure. Never
  unblock by dropping the paired-artifact requirement or fabricating live results.

- Anticipated capability gap (record inline if still true at capture
  time): the `thin` harness is single-turn and text-only, so it cannot
  apply file edits. The scenario predicate will fail against its
  working directory while the adapter's streamed text may contain a
  reference patch proposal. That gap is inherent to the harness's
  declared contract and does not block "coding-agent parity" — it
  delineates which registered harnesses are coding-capable rather than
  text-only.

## Status (2026-05-07 blocker audit)

The infrastructure was shipped, but all-harness live evidence was missing.
That audit prescribed an operator-capture cadence, superseded by the current
contract. A local dry run was not evidence of coding-task parity.

## Status (2026-06-15 blocked audit)

A bounded local probe succeeded for one small slice:
`CODEX_HOME=/Users/xmanatee/.codex pnpm kota harness-parity run --scenario
fix-arithmetic-bug --harness codex --max-turns 4 --out
.kota/runs/blocked-audit-2026-06-15/harness-parity-codex/fix-arithmetic-bug`
passed with `verification=pass`, one turn, and one changed file. That proves
the Codex harness path was locally viable. The audit did not promote the task
under its then-current all-harness capture rule; the path itself does not
invalidate this partial result.

## Historical disposition (2026-09-10)

The June 15 Codex/GPT-5.5 slice passed verification with one changed file. Its
directory prefix does not invalidate it; it remains historical partial evidence,
not current all-adapter parity. Use the existing harness-parity run command with
compatible --harness/--model/--out routing and each registered adapter's actual
auth contract. Authorized runtime collection is allowed; no human must type each
command. Preserve paired prompt/trace/diff/verifier artifacts, missing-auth rows
and explicit text-only capability gaps. Do not reclassify absent credentials as
an incapable model or an unfinished row as passed.


## Repair evidence (2026-09-12)

Run `2026-09-12T06-41-33-284Z-builder-69znjo` fixed the ordinary parity
command's provider scope: `runHarnessParity` now passes the selected scope
through to `runAgentHarness`, matching the matrix path. Previously credential
and configuration resolution fell back to the artifact directory. Candidate
edits still happen in a fresh scenario copy. The focused regression observes
both scope propagation and the separate candidate working directory. Module
guidance now honors the owner's authorization for autonomous live collection
and documents native versus provider-qualified model selection and separate
output directories.

Evidence is under the runtime-returned directory
`.kota/runtime/2026-09-12t06-41-33-284z-builder-005410a5f7cb140240f38e15b37d7e82bda3a15d323f319e55d45a03ea87cf7f/agent/harness-parity/`:

- `gemini-route/fix-arithmetic-bug/gemini/` contains runner-generated prompt,
  trace summary, empty diff, verifier failure, run metadata and trajectory
  diagnostics. `gemini-route/fix-arithmetic-bug/parity.json` records the result.
  The actual CLI invocation used `--harness gemini --model gemini-2.5-pro
  --scenario fix-arithmetic-bug --max-turns 4`. It returned zero turns and no
  changed files. The failure was an `EPERM` creating the selected scope's
  protected conversation-store lock, before adapter/provider execution.
  This is execution-boundary evidence, not a failed model solution or auth test.
- `shipped-adapter-contracts.json` records the nine bundled module contributions
  without invoking credential probes. It is a source-contract inventory, not
  an assertion about a different host's loaded registry or readiness.
- `assessment.md` records the operator commands, local endpoint probes,
  dispositions and validation. The `thin` matrix probe rejects with
  `invalid_harness_pair` because that adapter has no matrix routing declaration;
  ordinary `run` remains the available interface for that adapter.

| Adapter | Current capture / remaining route requirement |
| --- | --- |
| `codex` | Unrun. Native model ids and adapter-owned Codex login; original and invocation login files are explicitly denied to this worker. Host login and entitlement are unknown. |
| `claude-agent-sdk` | Unrun. Native Claude model ids and SDK-owned auth. `ANTHROPIC_API_KEY` is absent from this worker environment; host SDK login/key availability is unknown. |
| `openai-tools` | Unrun. Declared ModelClient matrix routing accepts compatible `provider/model` ids; selected-scope secret resolution requires the trusted runtime. No API key is exposed to this worker. Local model discovery could not reach its configured proxy. |
| `openai-tools-scaffold` | Unrun. Same ModelClient execution prerequisite; compound tools remain a distinct adapter row. |
| `gemini` | Attempted through the real runner with `gemini-2.5-pro`; rejected at shared session ownership before inference. `GEMINI_API_KEY` and `GOOGLE_API_KEY` are absent from this worker environment; host auth is unknown. |
| `gemini-cli` | Unrun. Adapter intentionally rejects credential-bearing native execution until provider-only authentication exists; its scoped guidance explicitly limits it to credential-free diagnostics. Deferred capability row under the waiver. |
| `antigravity-cli` | Unrun. Requires adapter-owned `agy models` authentication/catalog verification and isolated native launch with host-managed login. Neither was established in this worker; no inference or host auth absence is claimed. |
| `vercel` | Unrun. Own SDK provider registry accepts `openai/model`; `OPENAI_API_KEY` is absent from this worker environment. Host availability is unknown. Ordinary `run` does not require a matrix declaration. |
| `thin` | Text-only by contract; no editing tool loop. Matrix admission rejects its missing routing declaration. Use ordinary `run` with a provider-qualified model for a future text-only comparison; it cannot satisfy code-edit parity and is a non-blocking capability exception. |

The same shared `prepareSessionContinuity` boundary precedes all adapter runs;
repeating launches against its denied lock would not test another provider.
No credential files were opened or copied, no proxy bypass was attempted, and
no parent daemon was controlled. A local provider discovery request to each of
LM Studio and Ollama failed connecting to the worker-configured proxy at
127.0.0.1:62387. This does not establish that either inference service is down.
The exposed tools contain no KOTA host-action/evaluation adapter. The existing
native authorization request/reply service only validates active-writer identity;
it is not an execution or credential export service.

Validation: `pnpm check:fast` passed; the focused operations and matrix-request
owner tests passed (11 tests). The regression protects scope propagation without
moving candidate edits into the source scope; the existing request tests cover
provider-qualified model encoding, output-token limits and rejected local effort.
The real CLI list, matrix rejection and Gemini failure artifacts establish the
available operator journey and its present limit. These are not live coding
successes. No all-adapter or native-versus-KOTA parity claim is made.

## Blocked on

kind: operator-capture
path: .kota/runs
description: Attributable task-linked evidence of a callable trusted parity invocation with owned session state and provider access, or current paired supported-route results.

This evidence-review kind records an execution-access prerequisite, not a
manual capture requirement. The path is a discovery hint; equivalent scoped
runtime exports are accepted. Reopen when a permitted invocation is available,
without waiting for the coding measurement itself to be completed.

A trusted runtime invocation of the existing harness-parity surface, or
attributable current exported supported-route results, is required to complete
the live coding outcome. The invocation must own its conversation state and
provider access while keeping candidate execution isolated. This worker cannot
acquire the protected conversation lock, has no exposed host-evaluation action,
and its configured network proxy is unreachable. This is a limit of this
invocation's callable execution boundary, not a claim of absent host credentials.
The existing runtime-mediated contained-evaluation task owns related mediation;
its writer and task contract were not changed. No new execution bridge is added
here, and manual human capture is not required.

Resume this same task when a scoped runtime action is callable or current paired
results are exported. Execute supported routes, compare the same scenario/model,
retain prompt/trace/diff/verifier outcomes and account for the unavailable rows
under the September 12 waiver. Unavailable individual adapters do not gate
supported-route work; the currently unfulfilled requirement is any current
successful supported coding run. The scope-routing fix is independently
validated and safe to retain; it does not complete live parity acceptance.
