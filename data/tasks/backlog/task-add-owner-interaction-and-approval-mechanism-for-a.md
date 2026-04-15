---
id: task-add-owner-interaction-and-approval-mechanism-for-a
title: Add owner interaction and approval mechanism for agents
status: backlog
priority: p2
area: architecture
summary: Allow agents to escalate high-stakes decisions to the owner with structured questions and resumable execution
created_at: 2026-04-15T21:22:25.531Z
updated_at: 2026-04-15T21:22:25.531Z
---

## Problem

Autonomous agents sometimes face high-stakes decisions (architectural direction, scope changes, ambiguous requirements) where proceeding without owner input risks wasted work or wrong direction. There is no structured mechanism for an agent to pause, ask a concrete question, and resume with the answer.

## Desired Outcome

- Agents can emit a structured question with context, a concrete ask, and proposed answers when facing a high-stakes decision.
- A review gate filters frivolous questions before they reach the owner — only well-formed, high-impact questions pass through.
- Execution resumes from where it paused once the owner responds.
- Owner questions are surfaced through existing channels (clients, notifications).
- Consider using the task system itself: assign to "owner", move to blocked, resume on answer.

## Constraints

- The mechanism must not become a crutch for poorly scoped tasks. The bar for asking must be high and enforced.
- Questions must be concise: brief context, concrete question, proposed answers where possible.
- Start simple (file-backed under `data/`) before adding client integration.

## Done When

- Agents can escalate a question and block on the answer.
- A review layer rejects low-quality or unnecessary questions.
- At least one client surfaces pending questions.
- Execution resumes correctly after an answer is provided.
