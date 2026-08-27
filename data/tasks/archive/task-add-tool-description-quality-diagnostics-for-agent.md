---
status: done
---

# Add tool-description quality diagnostics for agent tool selection

## Problem

KOTA tells agents that tool names, descriptions, schemas, and admitted-tool
summaries are the source of truth for current capabilities. That is the right
runtime boundary, but the quality gate is still mostly "description exists".
First-party or custom tools can therefore ship terse, generic, or effect-blind
descriptions, and external MCP tools can arrive with missing purpose, unclear
inputs, or no "do not use this when..." guidance. The agent then has to infer
tool intent from weak natural language even though KOTA already has structured
schemas, effects, MCP annotations, and declaration fingerprints nearby.

This is not a request to rewrite every tool description or add a model-based
scanner. The local gap is a deterministic diagnostic surface: KOTA should be
able to say which local or remote tool descriptions are weak for agent tool
selection, why they are weak, and where the operator or builder should fix the
declaration.

## Desired Outcome

Add a compact, typed tool-description quality checker for first-party
`ToolDef` declarations and external MCP `tools/list` declarations. The checker
should emit bounded diagnostic codes such as:

- missing or unclear purpose;
- missing effect or authority boundary;
- missing input/output expectation when the schema or result contract needs it;
- missing negative-use guidance for high-authority, write, network, or
  delegation tools;
- generic or too-short description text; and
- possible description/schema mismatch when a description names fields or
  behavior that the schema does not expose.

Expose those diagnostics in operator/developer surfaces that already inspect
tools, such as focused tests, tool registry validation, MCP manager diagnostics,
or `agent-status`-style output. Remote MCP diagnostics should be warning-only:
they make weak declarations visible but do not reject a server or mutate the
server's advertised description. First-party diagnostics may be ratcheted as
tests once the current tool set is clean enough.

## Constraints

- Do not add an LLM/FM scanner, prompt-time judge, remote MCP marketplace
  crawler, or second tool registry.
- Do not rewrite remote MCP tool descriptions, synthesize augmented
  descriptions into agent prompts, or automatically expand every local
  description. The paper's result showed that full augmentation can increase
  execution steps and sometimes regress outcomes; KOTA should prefer compact
  diagnostics over prompt bloat.
- Reuse existing structured sources: `ToolDef.description`,
  `ToolDef.input_schema`, `ToolEffect`, MCP annotations, output schema, and
  declaration fingerprints. Do not create a parallel effect taxonomy.
- Keep diagnostic output bounded and sanitized. Do not print tool inputs,
  tool-result payloads, authorization headers, secrets, or remote resource
  contents.
- Keep exact diagnostic rules in code and focused tests, not in durable docs.
- Preserve current behavior for valid remote MCP tools. A poor description is
  a review signal, not a protocol error.

## Done When

- A typed description-quality analyzer exists for local tools and remote MCP
  declarations, with stable diagnostic codes and concise messages.
- First-party tool validation or focused registry tests can run the analyzer
  against representative local tools and catch generic, missing-purpose,
  missing-negative-guidance, and schema-mismatch examples.
- External MCP tool discovery records or exposes description-quality
  diagnostics alongside the existing declaration fingerprint without changing
  successful `tools/list` registration behavior.
- A bounded operator/developer output path can show the diagnostics for a tool
  set, including remote MCP tools, without adding long augmented descriptions
  to normal agent prompts.
- Focused tests cover: clean local tool, terse local tool, high-authority tool
  without negative-use guidance, remote MCP tool with no description, remote
  MCP tool with generic text, and a remote declaration refresh where
  fingerprinting still works independently from quality diagnostics.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run validate-tasks` pass.

## Source / Intent

Explorer run `2026-06-22T21-13-02-855Z-explorer-d7frwp` saw a strategic-ready
coverage gap: the only actionable ready task was a `p3` source-size cleanup,
there was no backlog, and the strategic blocked alternatives all still
required operator-captured evidence.

External source checked:

- `https://arxiv.org/abs/2602.14878` ("Model Context Protocol (MCP) Tool
  Descriptions Are Smelly! Towards Improving AI Agent Efficiency with
  Augmented MCP Tool Descriptions"), submitted February 16, 2026 and last
  revised May 31, 2026, evaluates 856 tools across 103 MCP servers. Its
  KOTA-relevant finding is that natural-language tool descriptions are a
  critical tool-selection input, weak descriptions are widespread, and compact
  component-aware description improvements can help reliability, while
  full-component augmentation can also increase execution steps and regress
  some cases. KOTA should distill that into diagnostics, not into automatic
  prompt expansion or remote declaration rewriting.

Local overlap check:

- `src/core/agents/system-prompt.ts` already tells agents to rely on resolved
  tool names, descriptions, schemas, and admitted-tool summaries.
- `src/core/agents/tool-guidance.ts` truncates descriptions for prompt
  summaries, so adding long augmented text would directly compete with context
  budget.
- `src/core/tools/index.test.ts`, custom-tool validation, and module manifest
  validation require descriptions to exist, but they do not diagnose whether a
  description is useful for tool choice.
- `data/tasks/archive/task-tool-description-policy.md` edited description strings
  to include negative guidance; it did not add a reusable diagnostic or MCP
  discovery surface.
- `data/tasks/archive/task-fingerprint-remote-mcp-tool-declarations-across-re.md`
  records when remote tool descriptions change, but does not say whether the
  current description is weak.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` remains blocked on
  `.kota/runs/scientific-claim-reproduction-live-pass/`.
- `task-add-an-unfamiliar-language-strategy-construction-f` remains blocked on
  `.kota/runs/unfamiliar-language-strategy-construction-live-pass/`.
- `task-add-cross-preset-runtime-parity-gate` remains blocked on
  `.kota/runs/preset-parity-all-keys-set/`.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` remains blocked on
  all-registered-harness `.kota/runs/harness-parity-*` capture.

## Initiative

Tool-selection reliability: KOTA should make the tool contract an inspectable,
high-signal surface for agents and operators without turning description
quality into a prompt-only convention.

## Acceptance Evidence

- Focused test transcript for the description-quality analyzer and local tool
  registry validation.
- Focused MCP manager test transcript showing weak remote descriptions are
  diagnosed while successful tool registration, declaration fingerprinting, and
  tool execution behavior remain unchanged.
- Sample bounded diagnostic output under `.kota/runs/<run-id>/` or a focused
  fixture showing local and remote tool diagnostic codes without raw tool
  payloads or secrets.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run validate-tasks` pass.

## Result

Added a deterministic tool-description quality analyzer, wired local
diagnostics into `agent_status`, and exposed remote MCP diagnostics alongside
tool declaration fingerprints without blocking remote registration or
execution.

## Evidence

- `.kota/runs/2026-06-22T21-36-55-470Z-builder-n045fg/focused-tests.txt`
  covers the analyzer, `agent_status`, MCP diagnostics, and fingerprint
  refresh behavior.
- `.kota/runs/2026-06-22T21-36-55-470Z-builder-n045fg/sample-description-diagnostics.txt`
  shows bounded local and remote diagnostic output.
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run validate-tasks`
