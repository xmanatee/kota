---
id: task-review-domain-local-ai-and-tooling-resource-group
title: Review domain, local AI, and tooling resources for optional module opportunities
status: backlog
priority: p3
area: modules
summary: Revisit historical resources for domain-specific services, local inference, forecasting, browser/search, and productivity tooling to identify realistic optional modules or adapter patterns.
created_at: 2026-04-11T01:49:31Z
updated_at: 2026-04-11T01:49:31Z
---

## Problem

The historical resource packet included domain-specific plugins and services,
local AI and forecasting tools, browser/search tools, Google Workspace and
GitHub wrappers, Obsidian, PDF, and multimodal examples. Some ideas became
concrete modules or tasks, but the broader set was not revisited after KOTA's
module architecture changed.

## Desired Outcome

Review this group as optional capability inspiration. Decide which resources
are already covered, which deserve future optional modules or adapters, and
which should remain reference-only.

## Constraints

- Do not add domain features to core.
- Prefer thin wrappers around mature OSS tools or CLIs when useful.
- Do not create implementation tasks for speculative integrations without a
  clear operator benefit.
- Keep recommendations concise and grouped; avoid one task per link by default.

## Done When

- Domain-specific, local AI, forecasting, browser/search, and productivity
  resources have a current grouped disposition.
- Any strong adapter or module opportunity is captured as a focused task.
- Weak or speculative ideas are explicitly left as reference-only.
- Existing modules such as GitHub, Google Workspace, Vercel adapter, and
  Telegram are considered before proposing new work.
