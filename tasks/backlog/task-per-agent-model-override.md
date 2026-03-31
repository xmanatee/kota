---
id: task-per-agent-model-override
title: Allow per-agent model override in kota config
summary: Add agentModels config field to override the model for named built-in and extension agents.
status: backlog
priority: p3
area: runtime
created_at: 2026-03-31T03:00:00Z
updated_at: 2026-03-31T03:00:00Z
---

## Problem

Built-in agents (explorer, builder, improver) have their Claude model hardcoded in `src/agents/index.ts` as `claude-sonnet-4-6`. Users who want to run builder with a more capable model (e.g. `claude-opus-4-6`) for better code quality, or run explorer with a cheaper model (e.g. `claude-haiku-4-5-20251001`) for cost savings, cannot do so without editing source code.

The config already supports `model` (global default) and `modelTiers` (tier mapping for sub-agent delegation), but has no mechanism to override the model for named built-in agents.

## Desired Outcome

- `kota.config.json` (or `.kota/config.json`) accepts an `agentModels` map: `{ [agentName: string]: string }`
- When a built-in or extension-contributed agent is loaded, its `model` field is overridden by the config value if present
- Config parsing in `src/config.ts` validates the `agentModels` field and merges it across config layers
- `kota agent inspect <name>` reflects the resolved model (including any override)
- `kota agent list` output shows the effective model per agent

## Constraints

- No change to `AgentDef.model` type — override happens at resolve time, not definition time
- Config-level override applies after extension registration, so extension-contributed agents are also overridable
- Invalid model strings are passed through without validation (same as the top-level `model` field)
- Default behavior (no config entry → use definition model) unchanged

## Done When

- `agentModels` field accepted in kota config and merged across layers
- Agent resolution applies the override when present
- `kota agent inspect` and `kota agent list` reflect effective model
- Existing agent and config tests pass
