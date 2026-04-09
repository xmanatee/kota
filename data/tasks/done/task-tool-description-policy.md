---
id: task-tool-description-policy
title: Add "when NOT to use" guidance to tool descriptions
status: done
priority: p3
area: tools
summary: Tool descriptions currently describe what tools do, but not when to avoid them. Adding negative examples reduces unnecessary sub-agent spawning and redundant tool calls.
created_at: 2026-03-19
updated_at: 2026-03-19T06:40:00
---

## Problem

KOTA's tool descriptions describe capabilities but do not constrain when tools should not be called. This leads to over-use patterns: sub-agents spawned for simple queries, redundant reads, unnecessary retries. Negative guidance ("do not call this when X") is more effective than positive guidance alone for tool selection.

## Desired Outcome

Each tool definition includes explicit "when NOT to use" guidance. The agent over-uses expensive tools less frequently. Simple reads and searches prefer cheaper direct paths.

## Constraints

- Changes are to tool description strings only — no behavior changes to tool implementations.
- Do not make descriptions so long they consume significant context budget.
- Focus on the tools most frequently misused (sub-agent spawning, file reads, search).

## Done When

- All tools with known over-use patterns have "when NOT to use" guidance added.
- At least one before/after example in the task notes shows the guidance prevents a known bad pattern.

## Notes

### Before/After Examples

**delegate (over-use pattern prevented):**
- Before: agent delegates "find all TypeScript files in src/" to a sub-agent
- After: "Do NOT use when a single grep, glob, or file_read call would answer the question" → agent uses `glob("**/*.ts", "src/")` directly

**file_read (over-use pattern prevented):**
- Before: agent calls file_read on 10 files looking for a pattern
- After: "Do NOT use to search for patterns across files (use grep)" → agent uses grep with the pattern once

**grep used instead of glob (prevented):**
- Before: agent runs `grep "" --files-with-matches "**/*.ts"` just to list TypeScript files
- After: "Do NOT use to find files by name or module only (use glob)" → agent uses glob directly

## References

- Claude Code 2.0 guide: "tool descriptions as policy" — negative examples outperform positive-only for tool selection
- LabClaw SKILL.md pattern: structured per-tool files with when/how/output expectations
