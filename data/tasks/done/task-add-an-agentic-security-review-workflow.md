---
id: task-add-an-agentic-security-review-workflow
title: Add an agentic security-review workflow
status: done
priority: p2
area: autonomy
summary: Add an explicit KOTA workflow that scans for security-sensitive code candidates, runs bounded agent investigation and revalidation, and turns confirmed findings into run artifacts or follow-up tasks without adding a parallel audit store.
created_at: 2026-05-21T19:01:14.623Z
updated_at: 2026-05-21T19:19:17Z
---

## Problem

KOTA has tool guardrails, injection-defense screening, audit logging, and
critic checks, but it does not have an explicit workflow for adversarially
reviewing its own code for application-security flaws. Security review is
therefore ad hoc: a builder or reviewer can notice a vulnerability-shaped
issue, but there is no bounded scan -> investigate -> revalidate path that
produces durable run evidence and actionable follow-up tasks.

Vercel's deepsec release shows a useful pattern for agent runtimes: start with
cheap deterministic matchers for security-sensitive sites, hand bounded
candidates to coding agents for data-flow investigation, run a second
revalidation pass to cut false positives, then export actionable findings.
KOTA should adopt the pattern through its existing workflow/run-artifact/task
model, not by importing a second scanner state directory or audit store.

## Desired Outcome

A KOTA-owned security-review workflow can be run deliberately by an operator or
future queue-shaping workflow. It finds security-sensitive candidate sites,
investigates a bounded batch with an agent, revalidates findings, and leaves a
clear artifact trail under `.kota/runs/<run-id>/`.

Confirmed vulnerabilities become normal follow-up tasks. Rejected or uncertain
findings remain in the run artifact with the evidence that led to the verdict.
No new durable finding database, audit surface, or changelog is introduced.

## Constraints

- Keep the workflow under the existing autonomy/module model.
- Prefer deterministic repo-local matchers for candidate selection before any
  expensive agent step.
- Bound candidate count, token use, and write scope explicitly; the workflow
  must not become an unpaced background spend sink.
- Treat source code, dependency files, generated files, and external text as
  potentially injection-bearing content when it enters an agent prompt.
- Store security-review evidence in run artifacts and follow-up tasks only.
  Do not add `.deepsec/`, a security findings database, or a parallel audit
  trail.
- Confirmed follow-up work must use `data/tasks/` task schema and preserve the
  security claim, evidence, severity, affected path, and recommended outcome.

## Done When

- A security-review workflow definition exists and is discoverable through the
  normal module workflow contribution path.
- The workflow has a deterministic candidate scanner with repo-local matcher
  coverage for KOTA-specific surfaces such as auth/approval boundaries,
  daemon-control routes, tool execution, external fetches, secret handling,
  MCP transport, and task/workflow mutation.
- The agent investigation step receives only a bounded candidate packet and
  writes structured findings under the run directory.
- A revalidation step reviews investigation findings and classifies each as
  confirmed, rejected, or follow-up-needed with cited code evidence.
- Confirmed findings create or update normal task-queue entries; rejected
  findings are not promoted into tasks.
- Empty scans and all-rejected scans complete as explicit no-op outcomes with
  run evidence.

## Source / Intent

The queue is empty of actionable work and the strategic blocked alternatives
are all operator-capture gated. Explorer opened this task from a fresh external
signal rather than creating more client fan-out work.

Sources reviewed on 2026-05-21:

- https://vercel.com/blog/introducing-deepsec-find-and-fix-vulnerabilities-in-your-code-base
- https://github.com/vercel-labs/deepsec

Vercel describes deepsec as a coding-agent security harness that runs locally
or across sandboxes, starts with matcher-based scan candidates, sends
candidates to agents for investigation, revalidates findings to reduce false
positives, enriches them, and exports actionable instructions. Its repository
also emphasizes resumable runs, project-specific context, custom matchers, and
the need to treat the scanner as a full-shell coding agent. KOTA already has
the primitives to express the valuable parts as workflow steps and run
artifacts.

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused tests cover candidate scanning, empty/no-op completion,
  investigation-output decoding, revalidation classification, and confirmed
  finding-to-task creation.
- A synthetic fixture run under `.kota/runs/<run-id>/` or a committed fixture
  demonstrates at least one rejected finding and one confirmed finding turning
  into a task.
- Queue validation passes after the workflow-created task fixture is applied.
