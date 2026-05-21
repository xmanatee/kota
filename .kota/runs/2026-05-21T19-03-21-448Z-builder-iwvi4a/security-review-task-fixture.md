---
id: task-security-review-caller-controlled-url-reaches-fetch-without-validation
title: "Security review: Caller-controlled URL reaches fetch without validation."
status: ready
priority: p1
area: security
summary: Caller-controlled URL reaches fetch without validation.
created_at: 2026-05-21T19:03:21.448Z
updated_at: 2026-05-21T19:03:21.448Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/web-access/web-fetch.ts
claim: Caller-controlled URL reaches fetch without validation.

## Desired Outcome

Add explicit URL validation before fetch.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-05-21T19-03-21-448Z-builder-iwvi4a.

finding id: confirmed-fetch
candidate id: external-fetch:src/modules/web-access/web-fetch.ts:1
verdict: confirmed
rationale: The candidate remains exploitable after reviewing call sites.

Evidence:

- src/modules/web-access/web-fetch.ts:1 - await fetch(url, { headers });

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
