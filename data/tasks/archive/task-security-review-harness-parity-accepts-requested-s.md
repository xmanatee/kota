---
status: done
---

# Security review: Harness-parity accepts requested scenario ids and passes them into scenario loading without slug validation or a realpath containment check. A crafted id containing parent-directory segments can make the runner load a scenario tree outside the shipped scenarios root; that external scenario's verification.command is then executed with shell: true.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/harness-parity/scenario.ts
claim:

> Harness-parity accepts requested scenario ids and passes them into scenario loading without slug validation or a realpath containment check. A crafted id containing parent-directory segments can make the runner load a scenario tree outside the shipped scenarios root; that external scenario's verification.command is then executed with shell: true.

## Desired Outcome

> Validate requested scenario ids as lowercase slugs before joining paths, and resolve/realpath the candidate scenario directory to prove it remains inside scenariosRoot before reading scenario.json. Add regression coverage that '../' scenario ids are rejected before any verifier can run.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-28T23-14-45-327Z-security-review-yl92rt.

finding id: harness-parity-scenario-id-path-traversal-verifier-execution
candidate id: tool-execution:src/modules/harness-parity/runner-files.ts:66
verdict: confirmed
rationale:

> Confirmed. routes.ts:111-112 accepts request-provided scenario strings, harness-parity-operations.ts:77-78 passes each id to loadScenario, and scenario.ts:559-568 builds scenarioDir with join(scenariosRoot, id) before reading scenario.json. parseScenarioSpec only requires id to be a non-empty string at scenario.ts:483-490 and returns it unvalidated at scenario.ts:515-516 and 539-540; loadScenario only checks spec.id === id at scenario.ts:569-573 and does not realpath-check containment before using initial/ at scenario.ts:575-582. The loaded verification command is executed by spawnSync with shell: true at runner-files.ts:66-67, so an escaped scenario tree can supply the shell command.

Evidence:

Evidence 1:

path: src/modules/harness-parity/routes.ts

line: 111

excerpt:

> const scenarios = asStringArray(body.scenarios);

Evidence 2:

path: src/modules/harness-parity/harness-parity-operations.ts

line: 78

excerpt:

> ? ids.map((id) => loadScenario(deps.scenariosRoot, id))

Evidence 3:

path: src/modules/harness-parity/scenario.ts

line: 559

excerpt:

> export function loadScenario(scenariosRoot: string, id: string): LoadedScenario {

Evidence 4:

path: src/modules/harness-parity/scenario.ts

line: 560

excerpt:

> const scenarioDir = join(scenariosRoot, id);

Evidence 5:

path: src/modules/harness-parity/scenario.ts

line: 568

excerpt:

> const spec = parseScenarioSpec(readFileSync(specPath, "utf-8"), scenarioDir);

Evidence 6:

path: src/modules/harness-parity/runner-stage.ts

line: 89

excerpt:

> const verification = runVerification(args.workingDir, stage.verification);

Evidence 7:

path: src/modules/harness-parity/runner-files.ts

line: 66

excerpt:

> const result = spawnSync(verification.command, {

Evidence 8:

path: src/modules/harness-parity/runner-files.ts

line: 67

excerpt:

> shell: true,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm test src/modules/harness-parity/scenario.test.ts src/modules/harness-parity/harness-parity-operations.test.ts -t "scenario loader|harness-parity operations"` passed, covering traversal-id rejection before verifier execution and symlink realpath containment.
- `pnpm typecheck` passed.
