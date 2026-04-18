---
id: task-session-level-autonomy-mode-to-decouple-operator-s
title: Session-level autonomy mode to decouple operator supervision from tool-risk approvals
status: done
priority: p2
area: guardrails
summary: Introduce a session-level autonomy mode (passive/supervised/autonomous) that operators set at session creation to gate or open up tool execution independently of tool-risk-based approvals
created_at: 2026-04-18T00:40:53.094Z
updated_at: 2026-04-18T03:58:41.238Z
---

## Problem

KOTA already has `approval-queue` for tool-risk approvals, `owner-questions` for directed asks, and `guardrails` for policy enforcement. What it does not have is a session-level axis that says "this whole session runs under supervision" or "this session is passive and must not write anything," regardless of which tools the agent tries to use. Today the operator's only lever is per-tool risk classification plus the existing approval queue, which is reactive and tool-by-tool. Adjacent projects (zeroclaw, openfang, openclaw) all expose a first-class autonomy mode per session — ReadOnly / Supervised / Full — because it is the operator's most natural mental model when delegating work, especially as KOTA starts running against external projects where trust levels differ by repo.

## Desired Outcome

- Each session carries an explicit autonomy mode chosen at session creation: `passive` (no writes; read-only tools only), `supervised` (every write-capable tool call is gated through the approval queue regardless of tool risk classification), and `autonomous` (today's default — tool-risk-based approval gating only).
- Autonomy mode is part of the session protocol in `src/core/`, not bolted on inside a single module, so interactive chats, autonomous workflow steps, and channel-routed sessions all honor it uniformly.
- Operators can set and see the autonomy mode from daemon-control clients (CLI, web, native) per session.
- Workflows can declare a default autonomy mode for their agent steps; the daemon enforces it when starting those sessions.

## Constraints

- Keep the mode axis orthogonal to per-tool risk classification. Do not collapse the two into one combined enum or fold approval-queue behavior into a session mode.
- Strict typed protocol: `"passive" | "supervised" | "autonomous"`, no nullable fields, no silent fallback to autonomous. Sessions must have an explicit mode from creation.
- No test-only overrides on session or step types. Tests set the mode through the real session creation path.
- Do not surface autonomy-mode cost signals into agent prompts. This is an operator control; agents should only see the effective tool-gating behavior.
- Place the session-protocol change in `src/core/` (session/tool-runner contracts) and keep operator CLI/route surfaces in their existing owning modules; do not create a new "autonomy" module.

## Done When

- The core session protocol carries an explicit `autonomyMode` field and the tool-runner/approval pipeline consults it before tool execution.
- Interactive `kota serve` sessions, workflow agent steps, and channel-routed sessions all respect the mode.
- Operator CLI/web/native clients can list sessions with their mode and change the mode of a running session via the daemon control API.
- Tests cover the three modes at the tool-runner boundary (passive blocks writes; supervised gates every write; autonomous matches today's behavior).
- Docs in the relevant `AGENTS.md` (session and approval-queue) describe the mode without duplicating the protocol's code-level contract.

