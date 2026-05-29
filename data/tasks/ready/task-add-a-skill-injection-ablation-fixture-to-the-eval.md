---
id: task-add-a-skill-injection-ablation-fixture-to-the-eval
title: Add a skill-injection ablation fixture to the eval harness
status: ready
priority: p2
area: modules
summary: Add a compact paired eval-harness fixture that proves KOTA can measure whether explicit skill injection helps, harms, or adds overhead on a local software task without treating skill presence as automatic value.
created_at: 2026-05-29T13:55:31.378Z
updated_at: 2026-05-29T13:55:31.378Z
---

## Problem

KOTA now has explicit skill resolution, imported skill directories, skill-pack
import, MCP-served remote skill candidates, and rejection of unsupported
skill-owned tool policy. Those tasks prove the mechanics of installing,
listing, reading, and injecting skills, but they do not prove the outcome-level
question: did a selected skill help the agent complete the software task, did
it add overhead without benefit, or did stale guidance make the result worse?

That gap matters because skills are easy to mistake for automatic capability.
KOTA intentionally keeps imported skills explicit-only, yet the eval harness
does not have a fixture that compares the same task with and without a skill
and records the marginal effect as artifact evidence. Without that path,
operators can validate "skill prompt appeared" while missing the harder
question of whether the skill improves a real workflow outcome.

SWE-Skills-Bench makes the risk concrete: its paired skill/no-skill evaluation
finds that most software-engineering skills have no measurable pass-rate
benefit, a few help, some harm due to version-mismatched guidance, and token
overhead can rise sharply even when pass rate does not improve. KOTA should
not import the benchmark or its dataset, but it should carry one compact local
ablation fixture so skill value is measured through the existing eval-harness
path rather than inferred from activation.

## Desired Outcome

Add a compact eval-harness skill-ablation capability and one shipped fixture
that runs the same local software task under controlled skill variants:

- a no-skill control;
- a focused explicit skill treatment; and
- either a mismatched/noisy skill variant or a deterministic warning path that
  proves such a variant can be represented without silent global injection.

The fixture should record a `skill-ablation` artifact or equivalent structured
section in `fixture-run.json` with per-variant outcomes: selected skill names,
skill provenance, prompt-resolution evidence, predicate results, objective
metrics, duration, token/cost facts when available, and a clear expected
direction for the ablation. The overall fixture should pass only when the
expected paired evidence is present and the final scoring semantics are
unambiguous.

The local task should be small and deterministic. The skill should encode a
reusable procedure or project convention needed for the task, not a literal
patch. The no-skill path may fail, produce a lower metric, or require more
observable work, but that expectation must be represented in fixture evidence
instead of in prose.

## Constraints

- Keep ownership in `src/modules/eval-harness/` and the existing skill
  resolver/imported-skill boundaries. Touch `src/core/modules/` or
  `src/modules/skill-ops/` only if the existing public skill-resolution
  protocol cannot expose the needed evidence cleanly.
- Do not add a second skill store, skill activation engine, prompt-injection
  path, benchmark runner, or scoring database.
- Do not import SWE-Skills-Bench data, Docker images, Hugging Face datasets, or
  its evaluation scripts. Use a small fixture-native project.
- Preserve explicit activation. The fixture must name the treatment skill
  deliberately and must not make imported skills enter `skills: "all"`.
- Treat skill content as guidance, not trusted code. Unsupported skill
  frontmatter and malformed imported-skill shapes should keep failing through
  the existing strict loaders.
- Keep pass/fail predicate-based. Objective metrics and token/duration facts
  are evidence, not a replacement for predicates unless the fixture declares a
  deterministic threshold predicate.
- Avoid production test-only flags or hidden overrides. If the runner needs a
  fixture variant concept, make it an eval-harness fixture protocol with
  focused tests and artifact output.
- Replay-backed evidence is acceptable for the first slice if the replay
  clearly exercises prompt resolution and variant scoring. A live LLM run may
  be an additional operator artifact, but should not be the only way local
  tests prove the contract.

## Done When

- The eval-harness fixture schema and runner can express a skill-ablation
  variant set or an equivalent paired-run fixture without duplicating the
  workflow runtime.
- A fixture such as
  `src/modules/eval-harness/fixtures/builder-skill-injection-ablation/` exists
  with `fixture.json`, `notes.md`, a minimal `initial/` tree, and any local
  fixture skill files needed for the treatment.
- The fixture starts from a failing or incomplete baseline and records
  per-variant evidence for the no-skill control and focused-skill treatment.
- The treatment skill is resolved through the same explicit skill path KOTA
  uses for normal agents. The artifact names the resolved skill and provenance
  without leaking unrelated skill content.
- The fixture's final predicates verify the expected task outcome, task-state
  movement, changed-path boundaries, and the presence/shape of the ablation
  evidence.
- Tests cover schema validation, fixture materialization, explicit skill
  selection, prompt-resolution evidence, no-skill control reporting, focused
  treatment reporting, mismatched/noisy skill representation or warning, and
  invalid skill metadata rejection through the existing loader path.
- `pnpm kota eval list` loads the new fixture.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` produces an
  inspectable artifact with the paired skill/no-skill evidence and passing
  final predicates.

## Source / Intent

Explorer run `2026-05-29T13-52-58-203Z-explorer-odszzo` found no ready or
doing work and no dependency-clear backlog work. The surfaced strategic
blocked alternatives were all legitimate operator-capture waits and not
movable, so the queue needed one strategic module-first task rather than
client fan-out or another blocked task.

External sources checked:

- `https://github.com/GeniusHTX/SWE-Skills-Bench` describes a benchmark dataset
  for evaluating whether injected skill documents improve real-world software
  engineering tasks. Its repository includes 49 task/skill pairs, a
  use-skill/no-use-skill evaluation path, pass-rate comparison scripts, failed
  test extraction, and token/duration analysis.
- `https://arxiv.org/abs/2603.15401` reports SWE-Skills-Bench as 49 public SWE
  skills, approximately 565 task instances across six subdomains, and paired
  execution-based verification with and without the skill. It reports that 39
  of 49 skills yield zero pass-rate improvement, the average gain is only
  +1.2%, token overhead can increase by 451%, and three skills degrade
  performance due to version-mismatched guidance.
- `https://huggingface.co/datasets/GeniusHTX/SWE-Skills-Bench` confirms the
  dataset shape: task prompt, skill document, test code, repo URL, pinned
  commit, Docker image, and pass-rate delta as the primary comparison signal.

Local overlap check:

- `task-agent-scoped-skill-injection`,
  `task-make-imported-skills-resolvable-by-agent-skill-inj`,
  `task-support-skillssh-style-skill-pack-imports`,
  `task-preserve-imported-skill-resources-as-directories`, and
  `task-consume-mcp-served-skills-as-explicit-remote-skill` completed skill
  discovery/import/resolution mechanics.
- `task-reject-skill-frontmatter-tool-policy-declarations-` completed the
  safety boundary for unsupported skill-owned tool policy metadata.
- Existing eval-harness fixtures cover no-op restraint, scope restraint,
  test-writing, empirical optimization, product canaries, security divergence,
  scientific reproduction, and multi-round persistence, but none compare one
  task across skill/no-skill variants or record skill marginal utility.

## Initiative

Skill and eval integrity: reusable guidance should remain explicit, auditable,
and outcome-graded. KOTA should measure skill usefulness through artifacts
instead of treating successful skill injection as proof of capability.

## Acceptance Evidence

- Diff showing the new fixture and any eval-harness schema, runner, predicate,
  objective-metric, or artifact updates.
- Focused test transcript covering the skill-ablation schema/runner behavior
  and skill-resolution evidence.
- `pnpm kota eval list` transcript showing the new fixture loads.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` transcript
  showing the fixture passes and reports paired skill/no-skill evidence.
- Run artifact under `.kota/runs/<run-id>/` or a committed fixture output
  showing per-variant predicate results, skill provenance, prompt-resolution
  evidence, objective metrics, and duration/token facts when available.
