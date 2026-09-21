---
status: done
---
# Security review: Scope-improvement discovery reads attacker-selected files outside its scope with daemon filesystem authority. Root guidance symlinks are followed even though fingerprint discovery skips symlinks, and explicit evidenceRefs containing '..' generate outside-scope guidance paths. The collector returns up to 800 characters as instruction excerpts, which the workflow includes in its unredacted scope-improvement artifact.

security family: 68cbd68615eae02a7e6bd07db02e51aa61aec1aec25d9e31d14c83ef20b118cd


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/autonomy/workflows/scope-improver/scope-improvement-discovery.ts
claim:

> Scope-improvement discovery reads attacker-selected files outside its scope with daemon filesystem authority. Root guidance symlinks are followed even though fingerprint discovery skips symlinks, and explicit evidenceRefs containing '..' generate outside-scope guidance paths. The collector returns up to 800 characters as instruction excerpts, which the workflow includes in its unredacted scope-improvement artifact.

## Desired Outcome

> Read guidance through a containment-enforcing filesystem boundary that rejects traversal and unauthorized leaf or ancestor links before opening content. Apply it to both unconditional root guidance and evidence-derived guidance paths. This repairs both demonstrated variants without granting authority from repository links or trigger text.

> Reject unauthorized guidance reads before content enters collected inputs or artifacts. Cover automatic root links, linked ancestors, explicit traversal, and ordinary contained guidance. The run's security-containment-probe.mjs and security-containment-probe.json retain successful synthetic reproductions of both variants and a normal-guidance control.

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

security evidence: 91b20d776aa130b1373c9de7b34bfcb6ddab47c7ac51d7c1d08d8866405a9abe
evidence identity: scope-improver-guidance-root-symlink-and-evidence-traversal-v1
production owner: modules/autonomy/scope-improver
violated invariant: guidance-reads-must-remain-within-authorized-scope
Common repair:
> Read guidance through a containment-enforcing filesystem boundary that rejects traversal and unauthorized leaf or ancestor links before opening content. Apply it to both unconditional root guidance and evidence-derived guidance paths. This repairs both demonstrated variants without granting authority from repository links or trigger text.
Exploit preconditions:
> An attacker can place a guidance symlink in a scope subsequently processed by scope-improver, or supply an explicit request with traversal-bearing evidenceRefs. The daemon must be able to read the external target. The symlink variant needs no explicit malicious request: automatic collection always considers root AGENTS.md and CLAUDE.md. Reading the resulting scope evidence exposes the copied content. Synthetic probes confirmed collection of external content; no real credentials or live daemon were accessed.
finding id: scope-improvement-guidance-outside-scope-read
candidate id: task-workflow-mutation:src/modules/autonomy/workflows/scope-improver/scope-improvement-discovery.ts:1
verdict: confirmed
rationale:

> The collector unconditionally considers root guidance and passes joined paths to readFileSync without containment checks. Explicit evidenceRefs also retain '..' components. Independently rerunning the synthetic probe reproduced external-content collection through both automatic root-symlink and explicit traversal variants; ordinary guidance remained readable. Workflow artifact construction retains these instruction excerpts. Exploitation requires control of the guidance link or an accepted explicit request, daemon-readable targets, and access to the resulting evidence. Fingerprint discovery's symlink exclusion does not protect the subsequent reader. Both variants share the same production reader and containment repair. No matching predecessor task was found.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/scope-improver/scope-improvement-discovery.ts

line: 45

excerpt:



> function changedFiles(trigger: WorkflowRunTrigger): string[] {
>   const files = trigger.payload.evidenceRefs;
>   if (!Array.isArray(files)) return [];
>   return files.filter((file): file is string => typeof file === "string");
> }

Evidence 2:



path: src/modules/autonomy/workflows/scope-improver/scope-improvement-discovery.ts

line: 51

excerpt:



> function instructionPathsForFiles(files: readonly string[]): string[] {
>   const paths = new Set(["AGENTS.md", "CLAUDE.md"]);
>   for (const file of files) {
>     const parts = file.split("/").filter(Boolean);
>     for (let i = 1; i < parts.length; i++) {
>       paths.add(join(...parts.slice(0, i), "AGENTS.md"));
>       paths.add(join(...parts.slice(0, i), "CLAUDE.md"));

Evidence 3:



path: src/modules/autonomy/workflows/scope-improver/scope-improvement-discovery.ts

line: 65

excerpt:



> for (const path of instructionPathsForFiles(files)) {
>     const fullPath = join(workspaceRoot, path);
>     if (!existsSync(fullPath)) continue;
>     const raw = readFileSync(fullPath, "utf-8").trim();
>     instructions.push({ path, excerpt: raw.slice(0, 800) });

Evidence 4:



path: src/modules/autonomy/workflows/scope-improver/scope-improvement-actions.ts

line: 227

excerpt:



> const path = join(runDirPath, SCOPE_IMPROVEMENT_ARTIFACT);
>   writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");


## Resolution and verification

Original priority: p1. Fixed in the scope-improver discovery and fingerprint
owners. Both guidance content readers now use the shared descriptor-anchored
filesystem boundary, which rejects leaf/ancestor symlinks and multiply linked
files before reading their content. Guidance path derivation ignores absolute,
traversal-bearing, and malformed references while preserving those references as
opaque evidence, including progress-reviewer artifact citations. Ordinary root
and nested guidance remains readable with the existing 800-character excerpts.
Unsafe filesystem reads fail collection before inputs can reach artifact writing.

Verification in builder run `2026-09-21T02-39-53-058Z-builder-lui28p`:

- The new component tests exercise the public collector with real synthetic
  files: automatic AGENTS.md/CLAUDE.md links, nested leaf links, a linked
  ancestor, traversal references, a hard link, and contained guidance controls.
  Before the fix, the initial rejection assertions failed for all 11 unsafe
  cases while both normal controls passed. Final assertions preserve opaque
  citations without allowing them to select guidance.
- The selected owner portfolio passed: 88 tests in 11 files across scope-improver,
  scope-improvement onboarding, dispatcher semantic reflection, and the shared
  anchored filesystem batch and parent-race suites. This checks containment,
  semantic handoff compatibility, normal discovery, and the reused race boundary.
- `pnpm check:fast` passed (types, lint, task validation, generated bindings,
  module admission); the production `pnpm build` passed. Final changed-file
  Biome and diff whitespace checks also passed.

No live daemon or real secret was accessed. These checks establish the filesystem
boundary and its maintained consumers; the full deterministic portfolio and
live model evaluations were not run. Runtime owns publication and deployment.
