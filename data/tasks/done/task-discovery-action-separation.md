---
id: task-discovery-action-separation
title: Separate read-only discovery tools from side-effecting action tools
status: done
priority: p2
area: tools
summary: KOTA tools mix read-only exploration and side-effecting actions in a flat list. Structurally separating them prevents accidental writes during exploration phases and enables safer sandboxed exploration.
created_at: 2026-03-19
updated_at: 2026-03-19T06:35:00
---

## Problem

KOTA's tool registry is a flat list with no distinction between read-only discovery tools (file reads, search, listing) and action tools (file writes, command execution, API calls). This means the agent can take side-effecting actions at any point during exploration, and there is no structural mechanism to prevent it. The agent must rely entirely on prompt instructions to avoid acting prematurely.

## Desired Outcome

Tools are categorized as `discovery` (read-only, no side effects) or `action` (can modify state). The categorization is explicit in tool metadata. Workflow phases that should be exploration-only can assert or enforce that only discovery tools are called.

## Constraints

- Do not break existing tool contracts or calling conventions.
- The categorization should be in tool metadata, not enforced via runtime restrictions (which would be complex and fragile).
- Start with categorization + logging; enforcement can come later.

## Done When

- Each tool has a `kind: "discovery" | "action"` field in its definition.
- At least one workflow phase uses this metadata to log or warn on unexpected action tool calls during exploration.

## References

- here-build/foundation Arrival framework: exploration tools run in a sandboxed Scheme interpreter where side effects are impossible by construction; action tools use batch-level context immutability
- Subprocess desync hypothesis: agent drift is caused by tool architectures that violate cognitive subprocess boundaries
