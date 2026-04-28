---
id: task-add-a-realistic-scale-multi-file-feature-completio
title: Add a discovery-driven scenario to the harness-parity scenarios pack
status: ready
priority: p2
area: architecture
summary: Extend src/modules/harness-parity/scenarios/ with a fourth scenario whose coverage point is symptom-level prompting — the prompt names only an observed failure (test output, error message, behavior gap), and the agent must explore the project to find what to change. This probes a coding-agent capability the three existing scenarios do not — discovery — without duplicating the smoke / multi-file-multi-turn / failure-and-revise coverage points the module's AGENTS.md already protects.
created_at: 2026-04-28T19:18:44.965Z
updated_at: 2026-04-28T19:18:44.965Z
---

## Problem

`src/modules/harness-parity/scenarios/` currently ships three coverage points
documented in the module's `AGENTS.md`:

- `fix-arithmetic-bug` — single-round-trip smoke fixture proving the parity
  plumbing.
- `extract-shared-helper` — multi-file, multi-turn fixture probing real
  coding capability across reads and writes.
- `revise-from-test-output` — failure-and-revise fixture probing tool-result
  carry-over across turns.

Each names the exact files the agent must touch in its prompt. None of them
exercise the **discovery** dimension: a real operator using KOTA as a coding
agent rarely hands the agent the exact file list. The typical surface is "this
test is failing", "this command emits the wrong number", or "this feature does
not work" — and the agent must search the project to identify the call sites,
the responsible module, and the appropriate fix.

A harness that can read files but cannot effectively explore (e.g. it lacks
or under-uses grep, glob, or file listing in the autonomous tool loop) will
clear all three existing scenarios while quietly failing the symptom-level
prompts an operator actually gives. The harness-parity claim — "general-
purpose coding agent across pluggable harnesses" — therefore rests on a
coverage point the scenarios pack does not yet exercise.

## Desired Outcome

- A fourth scenario lives at `src/modules/harness-parity/scenarios/<id>/`
  whose prompt names only the observable symptom (e.g. "`node test.js` exits
  non-zero with `<some output>` — make it pass without editing `test.js`")
  and intentionally does **not** name the file(s) the agent must edit.
- The `initial/` tree contains a small Node.js project with at least three
  source files, only one of which holds the bug. The other source files are
  plausible distractors (similar names, related responsibilities) so that a
  harness that mechanically picks the first matching file or stops after one
  read will not pass.
- The verification command is a single shell command whose exit status is the
  pass/fail signal — same shape as the existing three scenarios. The
  verification target is the assertion already wired into `test.js`.
- The scenario passes when the harness identifies and fixes the correct
  source file. It fails (with empty diff or wrong-file diff) when the harness
  cannot navigate the project on its own.
- The module's `AGENTS.md` "Scenario Coverage" section is updated to add a
  fourth coverage bullet describing the discovery dimension, alongside the
  existing smoke / multi-file-multi-turn / failure-and-revise bullets. The
  "do not delete any of the existing fixtures" rule remains intact.

## Constraints

- One scenario, one coverage point. The new scenario probes **discovery**
  specifically; do not bundle multi-turn refactor + failure-and-revise +
  discovery into one fixture. The existing three scenarios already isolate
  the other dimensions; adding a fourth that mixes them dilutes evidence
  rather than sharpening it.
- The scenario `id` must reflect the coverage dimension (e.g.
  `discover-failing-source`, `find-the-bug-among-distractors`), not the
  surface symptom — the fixture should read clearly when listed alongside
  `fix-arithmetic-bug`, `extract-shared-helper`, `revise-from-test-output`.
- The prompt must not name the file(s) to edit. It may instruct the agent
  to read the test, run the verification command, and search the project —
  same level of guidance an operator would give.
- The `initial/` tree must include at least three source files where the
  distractor files are realistic enough to require reasoning, not throwaway
  filler. A harness that cannot tell which file to edit should produce a
  meaningfully wrong (or empty) diff, not a coincidental near-match.
- Verification is a single shell command that exits zero only on the correct
  fix, mirroring the existing fixtures. Do not introduce a second
  verification mechanism, multi-step verification, or in-fixture grading
  scripts beyond what the assertion file already does.
- Do not change `runAgentHarness`, the runner, the `parity.json` shape, or
  any other harness-parity infrastructure. This task ships a fixture, not a
  framework change.
- Do not introduce a new harness, a new adapter, or a new capability tier.
  The existing capability-gap handling (text-only `thin` records the boundary
  honestly) applies unchanged.
- Output, scoring, and pass@k/pass^k metrics remain out of scope per the
  module's "What Does Not Belong Here" list. This task adds a fixture, not
  a regression gate.
- No fan-out from this task. CLI / web / Telegram / macOS / mobile / Slack
  surfacing of the new scenario, additional scenarios beyond this one, and
  any operator-runnable batch automation are out of scope.

## Done When

- `src/modules/harness-parity/scenarios/<id>/scenario.json` exists with a
  symptom-level prompt, a single-shell-command verification, and a clearly-
  named `id` reflecting the discovery dimension.
- `src/modules/harness-parity/scenarios/<id>/initial/` ships the small
  Node.js project with at least three source files (one buggy, two
  realistic distractors), the `test.js` assertion harness, and any helpers
  the project requires. `test.js` is not the file to edit.
- The new scenario can be loaded by `runScenario` and listed by
  `kota harness-parity list` without any code change to the runner or CLI.
  The scenario surfaces in the same shape as the existing three.
- A `harness-parity-operations.test.ts` (or `scenario.test.ts`, whichever
  already covers scenario loading) assertion confirms the new fixture
  parses, that its verification command and `initial/` tree resolve, and
  that the scenarios pack now reports four scenarios.
- `src/modules/harness-parity/AGENTS.md` lists the new coverage point under
  "Scenario Coverage" alongside the existing three, naming the discovery
  dimension and the property a non-discovery harness fails to satisfy.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` are green at the project
  root.

## Source / Intent

Identified by explorer in
`.kota/runs/2026-04-28T19-07-39-162Z-explorer-vlxl8s/` after the cross-store
correction-loop integration anchors landed (commit `0476c557` — "Anchor post-
retract answer settling through the conversational agent loop"). With every
load-bearing layer of the cross-store correction loop now anchored end-to-end
through the agent loop, the next strategic gap in KOTA's product claim is the
coding-agent demonstration. The harness-parity scenarios pack already covers
plumbing, multi-file-multi-turn, and tool-result carry-over; the discovery
dimension — where the operator gives only a symptom and the agent must locate
the source — is the missing coverage point that the "general-purpose coding
agent across pluggable harnesses" claim rests on in real operator use.

The choice to seed work outside the cross-store theme is deliberate. The
recent done queue is dominated by capture/recall/answer/retract seam fan-outs
across the five client surfaces, and the cross-store correction-loop initiative
is now structurally complete — every load-bearing layer has an end-to-end
agent-loop anchor. Continuing in that same theme would collapse the queue into
one repeated kind of local work (explorer's anti-pattern). This task pivots
into a different strategic thread (coding-agent parity) that is unblocked,
substantive, and module-owned.

## Initiative

General-purpose coding agent parity: KOTA should prove real coding-task
completion through every registered harness, with the harness-parity scenarios
pack covering the dimensions the product claim actually rests on — plumbing,
multi-file-multi-turn coding, tool-result carry-over, and discovery. With this
task in place, the scenarios pack covers the four coverage points an operator
would expect a "general-purpose coding agent" to clear before being trusted
with their work.

## Acceptance Evidence

- Diff covering the new `scenarios/<id>/` directory (scenario.json plus
  `initial/` tree), the `AGENTS.md` Scenario Coverage update, and the
  scenario-loader test assertion that the pack now reports four scenarios.
- A `kota harness-parity list` output capture under the run directory
  showing the new scenario appears in the same shape as the existing three.
- `pnpm test` output showing the existing harness-parity tests plus the
  new scenario-loader assertion all pass.
- A short note in the run directory recording the chosen symptom prompt,
  the buggy source file, and the names of the distractor files — so a
  future contributor can see what the discovery property tests against
  without rerunning the scenario.
