---
id: task-unify-kota-product-identity-and-capability-languag
title: Unify KOTA product identity and capability language
status: backlog
priority: p2
area: product
task_class: Product
depends_on: [task-complete-the-terminal-project-to-scope-migration]
summary: Present one product identity and describe coding, knowledge, research, communication, and assistant behavior as capability sets.
created_at: 2026-08-24T02:13:43.791Z
updated_at: 2026-08-24T02:13:43.791Z
---

## Problem

Top-level surfaces alternately call KOTA an AI coding agent, general-purpose AI
agent, personal assistant, and second brain. Those labels imply different
users, defaults, trust expectations, and success criteria and obscure the
daemon, scope, workflow, and operator-control model.

## Desired Outcome

Use one primary identity: "KOTA is a local-first agent automation runtime and
operator control plane." Describe coding, knowledge/recall, research,
communication, and personal-assistant behavior as discoverable capability sets
owned by modules rather than as competing product identities.

## Constraints

- Align package/server metadata, CLI help, system prompts, onboarding, clients,
  deployment surfaces, and durable product guidance.
- Keep module-local terms only where they name an actual capability; replace
  generic "second brain" copy with knowledge, memory, recall, or cited-answer
  language according to the surface.
- Do not add slogans, a second brand vocabulary, or a manually maintained
  capability inventory.
- Preserve KOTA's quiet, exacting, operator-first tone and avoid promotional
  framing.

## Done When

- Every top-level entry point gives the same one-sentence product identity.
- Coding, assistant, and knowledge behavior appears only as module capability
  language beneath that identity.
- Help, onboarding, empty states, metadata, and prompts use consistent scope,
  daemon, workflow, client, and channel terminology.
- A source-owned terminology check catches reintroduction of the conflicting
  top-level descriptions without banning legitimate module copy.

## Source / Intent

Owner-approved finding from the 2026-08-24 audit. Current evidence includes
"AI coding agent" in package/server metadata, "general-purpose AI agent" in
CLI, "personal assistant" in the system prompt, and "second brain" in answer
and mobile surfaces.

## Initiative

One clear KOTA product model and vocabulary.

## Acceptance Evidence

- Screened transcripts or rendered fixtures for CLI help, onboarding, web,
  mobile, and native surfaces plus inspected package/server metadata.
- Focused prompt fixture confirming the same identity without duplicating a
  module catalog.
- Terminology search report with intentional module-local uses explained.
