---
id: task-add-context-retrieval-effectiveness-diagnostics-to
title: Add context-retrieval effectiveness diagnostics to harness-parity artifacts
status: done
priority: p2
area: modules
summary: Derive deterministic retrieval-quality diagnostics from harness-parity trajectories so code-context tool runs show whether searches and reads reached task-relevant files before implementation.
created_at: 2026-05-29T08:38:32.627Z
updated_at: 2026-05-29T08:56:48.120Z
---

## Problem

KOTA's harness-parity artifacts now capture neutral trajectories,
trajectory-quality warnings, changed files, verification output, and bounded
tool-call telemetry. Those artifacts show that an agent searched or read
files, but they do not answer a more specific operator question: did the
agent's code-context discovery actually reach the files that mattered before
it started editing?

That leaves retrieval-heavy coding runs hard to compare. A harness can spend a
large fraction of a run on search, repo-map, MCP, or read-file calls and still
miss the task-relevant files; today the operator has to inspect raw
trajectories by hand to distinguish useful context gathering from noisy or
late discovery.

Sourcegraph's CodeScaleBench makes this gap concrete. It evaluates coding
agents on large and multi-repo developer tasks and compares local-file,
Sourcegraph MCP, Augment, and GitHub remote-code access configurations with
retrieval and trace analysis. The KOTA response should not import that
benchmark or add a second runner. The useful local gap is a deterministic
diagnostic layer over KOTA's existing harness-parity trajectories.

## Desired Outcome

Harness-parity writes a typed context-retrieval diagnostics artifact for each
harness run, and for each staged scenario stage, when the scenario declares
task-relevant files or paths.

The diagnostic should derive from existing trajectory frames and scenario
metadata:

- classify context-gathering tool calls such as search, repo-map,
  find-reference, go-to-definition, read-file, and remote-code lookup calls;
- record whether each declared relevant file/path was reached before the
  first implementation edit;
- distinguish useful discovery from late discovery, missed targets, and noisy
  irrelevant reads;
- preserve the harness/code-access configuration and artifact path in the
  top-level `parity.json` summary so side-by-side comparisons are possible
  without opening every raw trace;
- stay advisory by default, with scenarios able to opt into failing on missed
  retrieval targets only through an explicit verifier or diagnostic gate.

## Constraints

- Reuse `KotaAgentMessage` trajectory frames, existing harness-parity scenario
  metadata, and existing trajectory-diagnostics conventions. Do not scrape raw
  text traces, vendor CodeScaleBench, import Harbor, or add a parallel
  benchmark runner.
- Keep the scenario declaration typed and strict. Malformed retrieval
  expectations should fail scenario loading loudly.
- Keep records bounded: store tool names, file/path ids, match classes,
  ordering, counts, and frame references, not raw tool inputs/results or
  secrets.
- Work for both single-stage and staged scenarios without changing existing
  scenario behavior unless a scenario opts into the new metadata.
- Keep cost and model-choice optimization out of agent-facing prompts and
  autonomy context.
- If the durable artifact shape changes, update
  `src/modules/harness-parity/AGENTS.md` in the implementation task.

## Done When

- Harness-parity scenario specs can declare optional context-retrieval
  expectations, such as required files/globs or named path groups, and loader
  tests reject malformed declarations.
- The runner writes `context-retrieval-diagnostics.json` beside the existing
  trajectory diagnostics for each applicable harness run or stage.
- The artifact reports at least: expected targets, observed retrieval actions,
  first relevant retrieval frame, whether relevant retrieval happened before
  first edit, missed targets, noisy irrelevant read count, unsupported
  trajectory state, and compact warning codes.
- The top-level `parity.json` carries a compact summary and artifact path for
  the retrieval diagnostics alongside the existing trajectory diagnostic
  counts.
- At least one existing navigation-heavy scenario, such as `discovery`, opts
  into the metadata so the feature is exercised by real harness-parity
  scenario code.
- Focused tests cover clean discovery, missed target, relevant file read only
  after an edit, noisy irrelevant reads, staged scenario output, and a harness
  with unsupported trajectory frames.

## Source / Intent

Explorer run `2026-05-29T08-36-21-207Z-explorer-71ggil` reviewed an empty
actionable queue. The strategic blocked alternatives were legitimate
operator-capture waits and not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://github.com/sourcegraph/CodeScaleBench` describes a benchmark suite
  for evaluating how coding agents use external context-retrieval tools on
  large, enterprise-scale developer tasks, with frozen traces, aggregate
  summaries, and side-by-side baseline-vs-MCP comparisons.

Local overlap check:

- `task-record-per-tool-call-telemetry-in-agent-step-artifacts` records
  per-call timing and size metadata, but not whether discovery reached
  task-relevant files.
- `task-add-trajectory-quality-diagnostics-for-lucky-pass-` flags process
  warnings such as missing verification and blind retries, but not
  retrieval-target coverage.
- Harness-parity already owns paired coding-task artifacts and scenario
  metadata. The nonduplicative gap belongs there as an advisory artifact, not
  as a new eval runner.

## Initiative

Harness-parity evidence quality: KOTA should compare coding harnesses not only
by final diff and verification status, but by whether their context discovery
found the code that mattered through typed, inspectable artifacts.

## Acceptance Evidence

- Focused test transcript, for example
  `pnpm test src/modules/harness-parity/context-retrieval-diagnostics.test.ts src/modules/harness-parity/runner.test.ts`.
- Sample `context-retrieval-diagnostics.json` artifacts for clean, missed, late,
  noisy, and unsupported-trajectory cases under the run directory.
- Diff showing the scenario schema, runner output, top-level `parity.json`
  summary, and local `AGENTS.md` update if the durable artifact contract
  changes.
