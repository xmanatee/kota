---
id: task-define-and-enforce-thin-client-capability-contract
title: Define and enforce thin-client capability contracts across clients
status: ready
priority: p1
area: architecture
summary: Create one shared contract for thin clients covering capability discovery, provider readiness, dashboard availability, workflow definitions, action affordances, and error payloads, then align macOS, mobile, web, Telegram, Slack, and CLI consumers to it.
created_at: 2026-04-28T22:35:51.407Z
updated_at: 2026-04-28T22:35:51.407Z
---

## Problem

KOTA now has many thin clients and operator surfaces: CLI, web, macOS, mobile,
Telegram, Slack, and daemon HTTP consumers. They share backend capabilities but
do not share one explicit client contract for:

- discovering whether the daemon is online for the intended project;
- deciding which capabilities are available;
- presenting optional provider unavailability;
- opening dashboard/web UI surfaces;
- listing and triggering workflow definitions;
- decoding daemon error bodies;
- deciding which controls should be hidden, disabled, or explained.

This allowed drift: macOS opened a hardcoded dashboard URL, triggered workflows
by free-text name, and discovered provider problems only after rendering broken
sections.

## Desired Outcome

Define one thin-client capability contract and align all clients to it. The
contract should specify:

- daemon identity/project connection state;
- capability readiness and reason codes;
- route/action availability;
- dashboard availability and URL;
- workflow definitions and input-schema metadata;
- structured error payloads;
- presentation expectations for unavailable capabilities.

The implementation can be shared generated types, conformance fixtures,
contract tests, or a small client SDK surface, but the outcome must prevent
each client from inventing its own semantics.

## Constraints

- Do not make every client visually identical. The contract standardizes
  behavior and data semantics, not layout.
- Keep clients thin. No direct `.kota` reads except documented daemon discovery
  paths.
- Avoid a giant all-clients rewrite if a staged migration is safer; however, the
  task must leave a tracked matrix of migrated and remaining clients.
- Coordinate with provider readiness, macOS error handling, dashboard
  availability, and workflow picker tasks.
- Do not leak internal agent prompts, secrets, or provider config.

## Done When

- A repo-local contract exists for thin clients and is documented in the
  relevant `AGENTS.md` or docs.
- At least one automated conformance fixture/test verifies the contract shape.
- macOS and at least one non-macOS client consume the same contract for
  capability readiness/error/dashboard/workflow semantics.
- Existing client route strings and error parsing are reduced or centralized
  where they previously duplicated behavior.
- A migration matrix lists CLI, web, macOS, mobile, Telegram, and Slack status.

## Source / Intent

Owner follow-up on 2026-04-28: make sure addressing the tasks removes this type
of issue across all clients, modules, core, and related mechanisms. Investigation
showed the menu bar bugs were symptoms of a missing shared client contract, not
only isolated SwiftUI mistakes.

## Initiative

Cross-client contract integrity: every operator surface speaks one daemon
protocol instead of locally inferred semantics.

## Acceptance Evidence

- Contract docs or fixtures naming each covered capability.
- Test output from at least two clients proving they consume the same semantics.
- A migration matrix artifact under the run directory or task notes.
