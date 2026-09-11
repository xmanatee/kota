---
status: done
---

# Authorize tool writes against the targets the tool actually uses

## Confirmed failure

Reproduced through the production `executeToolCalls` pipeline on main
`0fa8700c8`, September 11, 2026, using disposable directories and synthetic data.
With `cwd` and `scopeRoot` set to a temporary project and
`agentWriteScope: ["allowed/"]`, call `module_factory` with:

```json
{"action":"create","manifest":{"name":"write-scope-probe"}}
```

The executor correctly rejects the call because its target is unknown. Add
`"path":"<project>/allowed/pretend.json"` to the same input and it succeeds,
writing `<project>/.kota/modules/write-scope-probe/manifest.json` outside the
authorized roots. The tool accepts the extra field but does not use it.
The probe used autonomous mode and the normal guardrail defaults; it did not
bypass the executor or replace policy decisions with mocks.

## Required outcome

Make filesystem authorization describe the operation that will execute.
`src/core/daemon/scope-policy-tool-query.ts` currently guesses a target from
generic input field names. Both `tool-runner-agent-write-scope.ts` and the
scope-policy gate consume that guess. Replace this inference with authoritative
target information from the registered operation and its execution context,
using the existing tool registration/effect and approval binding owners.

Inspect consumers of the shared query, including derived targets, multiple
targets and opaque execution. Unknown or incomplete targets must remain denied
under bounded write policies. Bind authorization to the same declaration and
inputs used for execution, including approval resumption. Correct
`module_factory` action effects as part of that contract: observation must not
masquerade as writing, and removal must retain destructive authorization.

Rejecting an extra `path` field on this one schema is insufficient. Do not add
a second policy engine, tool-name allowlist or caller-side permission workflow.

## Acceptance

- The real executor rejects the decoy-field reproduction without creating a file.
- Authorized real targets succeed; decoy fields cannot authorize derived or
  additional targets. Exercise agent write roots and scope-policy write roots.
- Permission review and execution use the same resolved operation. Unknown
  targets and changed declarations cannot gain authority on resume.
- Keep representative proofs at the execution/policy owner and retire replaced
  field-guessing assumptions; do not duplicate a matrix across every tool.

The separate module-filesystem task owns physical path confinement after an
operation has been authorized. This task owns the authorization mismatch and
does not depend on verification-LOC migration work.

## Outcome

Filesystem authorization now uses registered mutation-target resolvers and the
runner's execution context, with every destination checked by agent and scope
write policies. Local writes without complete destinations remain denied under
bounded policies. Filesystem batch edits, module manifests, notebooks and web
downloads declare their actual destinations; opaque/dynamic operations remain
unresolved. Download destinations add a filesystem check alongside their network
effect. Module-factory observation is read-only and removal is destructive.
Approval leases preserve unresolved invocation effects instead of substituting
static discovery effects. Git declares local reads and mutations explicitly;
its mutation targets remain unknown for every operation because configured
helpers can write during reads as well as mutations. Bounded filesystem policies
therefore deny Git calls. Optional locks and automatic diff index refresh remain
disabled, but do not establish mutation freedom.

The existing approval owner binds the registered runner, schema, inputs, resolved
and static effects, resolver identities, execution roots and destinations.
Opaque operations bind the working directory (including its implicit process
default) and scope root even when destinations cannot be enumerated. Preflight
rejects registration/declaration/root/target drift; execution retains the leased runner and
rejects changed inputs or destinations. Local clients and routes preserve the
queued working directory while their scope provider selects current scope
authority. Persisted execution roots are validated and fingerprint-bound; explicit
overrides and altered reviewed roots remain rejected. Workflow tools, nested tool calls and
Claude's built-in bindings consume the same target contract. Delegation preserves
registered tool and runner identity; its shell timeout is applied before authorization
so queued review and resumed execution retain the same bounded inputs.

## Verification

- Real executor cases reject the original module-factory decoy under agent and
  scope write policies without creating a file; authorized destinations persist
  the intended bytes. Module-loading integration covers complete batch-edit and
  ancillary download targets (only the outbound transport is substituted).
- A real Git subprocess control invokes a synthetic fsmonitor hook and writes a
  marker with unrestricted authorization. The same executor call under agent
  deny-all and scope writes-none is denied with no marker. The broader Git
  selection passes all 172 module tests, including index preservation and
  ordinary mutation behavior.
- Real worktree module-factory calls resume through both local-client approval
  and the bulk route, creating the manifest only in the reviewed worktree.
  Shell approval checks reject explicit root changes before and after leasing,
  reject altered stored-root projections, and execute at the reviewed root.
  Registration, effect, input, target and approval-receipt drift checks remain
  with their existing owners. Stored declarations reject relative roots.
- The repair selection passes 98 tests across eight files with one explicitly
  excluded, previously observed workflow-approval timeout. A broader 32-file
  selection also exercises the Git, executor, MCP and approval owners; its
  unresolved limits are 18 listener tests denied by sandbox loopback policy
  and that workflow-approval timeout. Three stale implicit-context expectations
  found by the broader run were corrected and pass in the repair selection.
- The delegated-shell repair passes 41 tests across six files. Real module-loaded
  shell execution returns the expected output with unrestricted scope policy,
  rejects writes under bounded agent and scope policies without creating a marker,
  and resumes approval with the reviewed 60-second timeout. Existing delegate
  context, runner-override rejection and approval-drift proofs also pass.
- `pnpm check:fast` passes production/test types, lint, task validation and
  generated binding checks. Earlier production emission passed into the
  run-owned build directory; asset packaging remains unverified because this
  sandbox cannot clear the existing dist directory.

Physical path confinement remains with the separate module-filesystem task.
