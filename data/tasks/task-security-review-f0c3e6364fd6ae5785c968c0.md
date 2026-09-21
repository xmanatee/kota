---
status: open
priority: p1
---
# Security review: The shared prompt resolver accepts any existing project override without checking its resolved target. Its host-side consumers then follow symlinks and read external file contents outside agent tool permissions. A synthetic bundled memory-skill override returned an external sentinel as the command's prompt, and the delegated system-prompt builder returned the same content. Module skill loading also stores this unchecked content for prompt use.

security family: f0c3e6364fd6ae5785c968c00e74c583f3690158bced186b5681a575a702dd68


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/util/kota-install-paths.ts
claim:

> The shared prompt resolver accepts any existing project override without checking its resolved target. Its host-side consumers then follow symlinks and read external file contents outside agent tool permissions. A synthetic bundled memory-skill override returned an external sentinel as the command's prompt, and the delegated system-prompt builder returned the same content. Module skill loading also stores this unchecked content for prompt use.

## Desired Outcome

> Give shared prompt loading an authorization-aware read boundary instead of returning an unchecked project pathname. Validate physical containment and protected-file restrictions before reading project overrides, while preserving independently trusted packaged assets and explicitly authorized external module assets. Migrate catalog, module-skill loading, and delegated-agent prompt loading together because they share this resolver.

> Prevent project-controlled prompt links from exposing unauthorized host content through every shared resolver consumer. Retain positive tests for contained project overrides and trusted packaged assets. The run's security-containment-probe.mjs and security-containment-probe.json demonstrate catalog and delegated-prompt disclosure with synthetic content and a normal local-prompt control. This repair is separate from scope-improver's independent guidance reader.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-21T01-20-23-518Z-security-review-eg3dgr.

Confirmed by security-review workflow runs:

- 2026-09-21T01-20-23-518Z-security-review-eg3dgr

security evidence: 06eff51a70163391c490dcd5f9619a62d16703a2e36beb016731614a8d0507e3
evidence identity: shared-project-prompt-override-symlink-content-disclosure-v1
production owner: core/util/kota-install-paths
violated invariant: project-prompt-paths-must-not-authorize-host-file-reads
Common repair:
> Give shared prompt loading an authorization-aware read boundary instead of returning an unchecked project pathname. Validate physical containment and protected-file restrictions before reading project overrides, while preserving independently trusted packaged assets and explicitly authorized external module assets. Migrate catalog, module-skill loading, and delegated-agent prompt loading together because they share this resolver.
Exploit preconditions:
> An attacker controls a project-local path matching a contributed skill or agent prompt and can make that path or an ancestor a symlink to a daemon-readable external file. A user invokes the corresponding skill, the module loader loads it, or an agent handoff resolves the matching prompt. No malicious executable module is needed for the bundled-skill variant. Synthetic probes confirmed disclosure through the production catalog and delegated-prompt builder; live provider transmission was not exercised.
finding id: shared-prompt-resolution-outside-scope-read
candidate id: task-workflow-mutation:src/modules/commands/catalog.test.ts:1
verdict: confirmed
rationale:

> resolveKotaPromptPath accepts an existing project override without validating its physical target. Catalog, module-skill loading, and delegated-agent prompt construction subsequently read that path with host authority. Independently rerunning the synthetic probe reproduced external-content disclosure through the production catalog and delegated prompt builder; ordinary local overrides remained functional. The bundled memory skill declares the demonstrated override path, so malicious executable module installation is unnecessary. Exploitation requires a project-controlled leaf or ancestor link, a readable target, and a matching prompt consumer. These consumers share one resolver repair; scope-improver uses a separate reader and appropriately remains a separate finding. No matching predecessor task was found.

Evidence:

Evidence 1:



path: src/core/util/kota-install-paths.ts

line: 23

excerpt:



> export function resolveKotaPromptPath(scopeRoot: string, promptPath: string): string {
>   const projectPath = resolve(scopeRoot, promptPath);
>   if (existsSync(projectPath)) return projectPath;

Evidence 2:



path: src/modules/commands/catalog.ts

line: 58

excerpt:



> function readSkillPrompt(skill: SkillDef, scopeRoot: string): string {
>   const path = resolveKotaPromptPath(scopeRoot, skill.promptPath);
>   return readFileSync(path, "utf8").trim();
> }

Evidence 3:



path: src/modules/commands/catalog.ts

line: 107

excerpt:



> const prompt = readSkillPrompt(found.skill, deps.scopeRoot);
>         if (!prompt) return null;
>         return { kind: "skill", prompt };

Evidence 4:



path: src/core/modules/module-loader-metadata-phases.ts

line: 58

excerpt:



> raw = readFileSync(
>         resolveKotaPromptPath(policy.cwd, skill.promptPath),
>         "utf8",
>       );

Evidence 5:



path: src/core/tools/handoff-agent-runtime-helpers.ts

line: 97

excerpt:



> const path = resolveKotaPromptPath(cwd, agent.promptPath);
>     const mainPrompt = readFileSync(path, "utf-8");
>     return [mainPrompt, skillsPrompt].filter(Boolean).join("\n\n");
