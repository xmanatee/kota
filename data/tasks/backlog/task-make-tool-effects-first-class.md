---
id: task-make-tool-effects-first-class
title: Make tool effects first-class
status: backlog
priority: p1
area: architecture
summary: Replace coarse tool risk/kind metadata with a first-class effect protocol that captures read/write/destructive/idempotent/open-world/resource-scope semantics and derives MCP annotations from it.
created_at: 2026-04-28T22:24:00.000Z
updated_at: 2026-04-28T22:24:00.000Z
---

## Problem

Tool metadata currently has two coarse fields: `risk:
safe|moderate|dangerous` and `kind: discovery|action`. That is not expressive
enough for reliable guardrails as tools expand. A local idempotent write, a
network read, a destructive external mutation, and an operator approval request
all need different policy handling, but the current protocol collapses them.

KOTA already derives MCP annotations in `guardrails-classify.ts`, but those
annotations are inferred from static name lists and coarse risk metadata rather
than declared by the tool's owning module.

## Desired Outcome

KOTA tools declare a first-class effect protocol:

- Read vs write vs destructive.
- Local filesystem vs daemon state vs external network vs operator surface.
- Idempotent vs non-idempotent.
- Open-world / exfiltration risk.
- Approval policy and autonomy-mode posture.
- Optional resource scope and write-scope hints.

MCP tool annotations are derived from this native protocol, not from parallel
name lists. Guardrails, approvals, prompts, and clients consume the same effect
metadata.

## Constraints

- Do not weaken current guardrails. The migration must be conservative:
  unknown effect should default to safer behavior.
- Do not duplicate MCP annotations as the source of truth. MCP annotations are
  an export format from KOTA's native effect protocol.
- Keep tool authoring ergonomic. A helper/builder can provide defaults for
  common read-only and local-write tools.
- Existing module-registered tools must migrate or carry explicit temporary
  compatibility metadata.

## Done When

- `ToolDef` / `ToolRegistration` expose a structured effect descriptor.
- Guardrail classification reads the effect descriptor instead of static name
  lists where possible.
- MCP `tools/list` annotations are derived from the effect descriptor and
  covered by tests.
- At least core tools plus two module tool groups are migrated.
- A guard prevents new tools from registering without effect metadata.

## Source / Intent

Investigation evidence:

- `src/core/tools/index.ts` and `src/core/modules/module-types.ts` both expose
  only `risk` and `kind`.
- `src/core/tools/guardrails-classify.ts` derives MCP annotations from static
  lists and coarse risk.
- MCP tools spec includes annotations such as read-only, destructive,
  idempotent, and open-world hints and separates protocol errors from tool
  execution errors.
- OpenAI Agents SDK guardrails documentation separates input, output, and tool
  guardrails; KOTA should make tool effects explicit enough to support similar
  boundaries.

## Initiative

Guardrail reliability: make tool policy a typed protocol owned by tools, not a
pile of inferred name lists and prompt conventions.

## Acceptance Evidence

- Tests showing destructive/open-world/idempotent/read-only annotations exported
  correctly over MCP.
- Tool guardrail tests proving autonomy-mode decisions read the new effect
  protocol.
- New-tool fixture failing when effect metadata is omitted.

