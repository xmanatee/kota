---
id: task-security-review-github-authored-text-is-admitted-t
title: Security review: GitHub-authored text is admitted through a four-pattern blacklist and persisted as quoted task markdown, but the decomposer later treats the entire task markdown as authoritative. Exposed step outputs are inserted into the agent prompt without the untrusted-content envelope or injection screening used for trigger payloads. Instruction phrasing that bypasses the narrow blacklist can therefore influence both the decomposition generator and its approving reviewer, whose output is deterministically persisted as actionable tasks.
status: ready
priority: p2
area: security
task_class: Safety
summary: GitHub-authored text is admitted through a four-pattern blacklist and persisted as quoted task markdown, but the decomposer later treats the entire task markdown as authoritative. Exposed step outputs are inserted into the agent prompt without the untrusted-content envelope or injection screening used for trigger payloads. Instruction phrasing that bypasses the narrow blacklist can therefore influence both the decomposition generator and its approving reviewer, whose output is deterministically persisted as actionable tasks.
created_at: 2026-08-03T17:21:44.125Z
updated_at: 2026-08-03T17:21:44.125Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/autonomy/workflows/github-mention-intake/workflow.ts
claim:

> GitHub-authored text is admitted through a four-pattern blacklist and persisted as quoted task markdown, but the decomposer later treats the entire task markdown as authoritative. Exposed step outputs are inserted into the agent prompt without the untrusted-content envelope or injection screening used for trigger payloads. Instruction phrasing that bypasses the narrow blacklist can therefore influence both the decomposition generator and its approving reviewer, whose output is deterministically persisted as actionable tasks.

## Desired Outcome

> Preserve provenance structurally when external text enters a task, screen it with the shared injection detector, and render taskMarkdown inside an escaped untrusted-content block for both decomposition steps. Give the reviewer a separately sanitized source representation, and add a regression covering blacklist-bypassing instruction text and closing-tag/fence content.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-03T16-47-03-618Z-security-review-5xx1f0.

finding id: security-review-github-task-injection-provenance-loss
candidate id: auth-approval-boundary:src/modules/autonomy/workflows/github-mention-intake/workflow.ts:222
verdict: confirmed
rationale:

> The intake uses a narrow four-pattern blacklist, while externally authored prose is later embedded in assess-failure.taskMarkdown. Both decomposition agents are instructed to treat that complete markdown as authoritative, and exposed step outputs receive neither the untrusted-content envelope nor detectInjection screening applied to trigger payloads. The inline warning and trusted-actor gate reduce likelihood, but do not preserve an enforced trust boundary; a blacklist-bypassing semantic instruction can influence the generated plan and its reviewer before code persists actionable tasks.

Evidence:

Evidence 1:



path: src/modules/autonomy/workflows/github-mention-intake/workflow.ts

line: 211

excerpt:



> function containsUnsafeInstructionText(text: string): boolean { return [four regular-expression patterns].some((pattern) => pattern.test(text)); }

Evidence 2:



path: src/modules/autonomy/workflows/github-mention-intake/workflow.ts

line: 297

excerpt:



> quoteUntrusted only HTML-escapes &, <, and > before preserving the external prose in the task.

Evidence 3:



path: src/modules/autonomy/workflows/decomposer/prompt.md

line: 12

excerpt:



> - Treat `assess-failure.taskMarkdown` as the authoritative original task.

Evidence 4:



path: src/core/workflow/steps/step-executor-agent-prompt.ts

line: 172

excerpt:



> lines.push(`<step id="${id}">`, JSON.stringify(output, null, 2), "</step>");

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
