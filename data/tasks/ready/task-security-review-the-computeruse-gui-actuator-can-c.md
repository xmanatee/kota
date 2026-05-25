---
id: task-security-review-the-computeruse-gui-actuator-can-c
title: Security review: The computer_use GUI actuator can click/type through native OS automation but is classified as safe, so passive/supervised autonomy gates allow it without approval.
status: ready
priority: p1
area: security
summary: The computer_use GUI actuator can click/type through native OS automation but is classified as safe, so passive/supervised autonomy gates allow it without approval.
created_at: 2026-05-25T23:36:19.101Z
updated_at: 2026-05-25T23:36:19.101Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/execution/index.ts
claim: The computer_use GUI actuator can click/type through native OS automation but is classified as safe, so passive/supervised autonomy gates allow it without approval.

## Desired Outcome

Classify computer_use as non-safe, likely dangerous or a dedicated GUI-control tier, and add tests proving passive denies it and supervised queues it for approval.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-25T23-29-14-103Z-security-review-iggnok.

finding id: security-review-computer-use-safe-gui-control
candidate id: tool-execution:src/modules/execution/computer-use-actions-linux.ts:50
verdict: confirmed
rationale: Current code still wires computer_use to native GUI actuators and declares it as an operator-surface write. riskFromEffect still maps operator-surface writes to safe, classifyRisk passes that safe tier through for declared-effect tools, and resolveAutonomyGate allows safe tools before passive or supervised gating can deny or queue them.

Evidence:

- src/modules/execution/computer-use-actions-linux.ts:50 - return execFileSync("xdotool", args, {
- src/modules/execution/index.ts:49 - effect: { kind: "write", scope: "operator-surface", idempotent: false, openWorld: true },
- src/core/tools/effect.ts:229 - case "operator-surface":
- src/core/tools/effect.ts:231 - return "safe";
- src/core/tools/autonomy-mode.ts:47 - if (assessment.risk === "safe") return { action: "allow" };

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
