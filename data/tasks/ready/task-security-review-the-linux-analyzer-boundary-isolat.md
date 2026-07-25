---
id: task-security-review-the-linux-analyzer-boundary-isolat
title: Security review: The Linux analyzer boundary isolates IP networking but retains the host filesystem, including pathname-based Unix-domain sockets. Node's permission model has no network/socket permission, so analyzer code can connect to same-UID host services such as container-runtime or database sockets despite the network namespace. The capability probe checks only network interfaces and host signaling, so it accepts this incomplete boundary.
status: ready
priority: p1
area: security
task_class: Safety
summary: The Linux analyzer boundary isolates IP networking but retains the host filesystem, including pathname-based Unix-domain sockets. Node's permission model has no network/socket permission, so analyzer code can connect to same-UID host services such as container-runtime or database sockets despite the network namespace. The capability probe checks only network interfaces and host signaling, so it accepts this incomplete boundary.
created_at: 2026-07-25T17:58:21.126Z
updated_at: 2026-07-25T17:58:21.126Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/eval-harness/scientific-claim-analyzer-sandbox.ts
claim:

> The Linux analyzer boundary isolates IP networking but retains the host filesystem, including pathname-based Unix-domain sockets. Node's permission model has no network/socket permission, so analyzer code can connect to same-UID host services such as container-runtime or database sockets despite the network namespace. The capability probe checks only network interfaces and host signaling, so it accepts this incomplete boundary.

## Desired Outcome

> Run analyzers in a disposable filesystem boundary that exposes only the analyzer, selected input, and output path, with no host sockets mounted. Add a Linux capability regression using a host pathname-based Unix socket and require the analyzer connection to fail before accepting the boundary.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-25T17-28-29-425Z-security-review-i6cvr8.

finding id: security-review-scientific-claim-linux-unix-socket-escape
candidate id: tool-execution:src/modules/eval-harness/scientific-claim-analyzer-sandbox.ts:1
verdict: confirmed
rationale:

> The Linux prefix at scientific-claim-analyzer-sandbox.ts:65-74 creates user, network, PID, proc, and inherited mount namespaces but no isolated root filesystem, leaving pathname-based Unix sockets visible. The capability check at scientific-claim-sandbox-capabilities.ts:27-36 and :190-220 tests interfaces and host signaling only. The Node invocation at scientific-claim-predicate.ts:149-158 grants filesystem paths but establishes no local-socket restriction. A runtime probe under Node v22.19.0 also connected successfully to an out-of-allowlist pathname socket while using --permission.

Evidence:

Evidence 1:



path: src/modules/eval-harness/scientific-claim-analyzer-sandbox.ts

line: 65

excerpt:



> The Linux prefix creates user, network, PID, and proc/mount namespaces, but does not provide an isolated root filesystem or hide host Unix-domain socket paths.

Evidence 2:



path: src/modules/eval-harness/scientific-claim-sandbox-capabilities.ts

line: 27

excerpt:



> The Linux network probe only inspects networkInterfaces() and succeeds when no non-internal interface is visible; it never probes a pathname-based Unix-domain socket.

Evidence 3:



path: src/modules/eval-harness/scientific-claim-predicate.ts

line: 149

excerpt:



> The analyzer runs with --permission and filesystem allowlists, but no socket or local-IPC restriction is established by the Node invocation.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
