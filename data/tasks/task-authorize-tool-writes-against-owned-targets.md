---
status: open
priority: p1
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
