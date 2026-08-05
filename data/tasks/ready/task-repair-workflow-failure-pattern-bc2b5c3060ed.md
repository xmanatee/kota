---
id: task-repair-workflow-failure-pattern-bc2b5c3060ed
title: Repair persistent improver workflow failure pattern
status: ready
priority: p1
area: autonomy
summary: Fix the local cause behind improver's persistent consecutive failure signal (step improve error a46a4e99c75a).
created_at: 2026-08-05T09:31:40.506Z
updated_at: 2026-08-05T09:55:43.330Z
task_class: Meta
---

## Problem

The `improver` workflow crossed the persistent failure-pattern gate.
The detector excluded classified infrastructure/provider/auth/rate-limit
and agent-step timeout failures before creating this task, so the remaining
signal is considered local and code-actionable.

Pattern fingerprint: `workflow-failure:consecutive-failures:improver:step-error:837684866e57`
Root-cause fingerprint: `workflow-failure-root:improver:3257d48a548c`
Evidence fingerprint: `e30e38ebeb97ac26b9165ff366744d8dd64122913f613a0f22359eebd37de156`

## Failure Evidence

- Pattern: consecutive failure
- Workflow: improver
- Failure class: step-error:improve:a46a4e99c75a
- Signal: step improve error a46a4e99c75a
- Run ids: 2026-08-05T07-44-52-890Z-improver-nhz0ks, 2026-08-05T09-29-13-611Z-improver-ttqzqt, 2026-08-05T09-30-07-323Z-improver-6mzalc, 2026-08-05T09-31-24-558Z-improver-r75jhz, 2026-08-05T09-32-17-250Z-improver-nyrxjm, 2026-08-05T09-33-05-520Z-improver-lpe8u3, 2026-08-05T09-34-02-499Z-improver-mxa011, 2026-08-05T09-34-59-175Z-improver-hh48ef, 2026-08-05T09-35-46-162Z-improver-fedsa4, 2026-08-05T09-36-20-539Z-improver-jp7hn3, 2026-08-05T09-37-09-877Z-improver-q5sl5o, 2026-08-05T09-37-47-721Z-improver-y5gkdz, 2026-08-05T09-38-50-396Z-improver-4gfehx, 2026-08-05T09-39-35-543Z-improver-ipbdeo, 2026-08-05T09-40-01-000Z-improver-dtzkba, 2026-08-05T09-40-52-937Z-improver-jsxf09, 2026-08-05T09-41-42-729Z-improver-ue3rmt, 2026-08-05T09-42-30-893Z-improver-n97mef, 2026-08-05T09-43-18-109Z-improver-5n391w, 2026-08-05T09-43-54-096Z-improver-vc2wdz, 2026-08-05T09-44-42-078Z-improver-svp3v4, 2026-08-05T09-45-17-585Z-improver-t8z371, 2026-08-05T09-46-05-058Z-improver-lg3eyq, 2026-08-05T09-46-40-799Z-improver-gp0zxl, 2026-08-05T09-47-31-617Z-improver-jiiyzo, 2026-08-05T09-48-28-706Z-improver-26oa60, 2026-08-05T09-49-18-644Z-improver-d22p1b, 2026-08-05T09-50-08-683Z-improver-7ydyg1, 2026-08-05T09-50-57-057Z-improver-3v3m9d, 2026-08-05T09-51-38-217Z-improver-9e1mv4, 2026-08-05T09-52-22-843Z-improver-bbzvg8, 2026-08-05T09-53-03-323Z-improver-fmvcf6, 2026-08-05T09-53-48-570Z-improver-m6buy2, 2026-08-05T09-54-33-519Z-improver-5a695x
- Window: 2026-08-05T09:29:02.290Z to 2026-08-05T09:54:55.287Z
- Actionable reason: improver has 34 consecutive failed completed runs with the same owned failure class (step improve error a46a4e99c75a).

- run 2026-08-05T09-54-33-519Z-improver-5a695x failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-53-48-570Z-improver-m6buy2 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-53-03-323Z-improver-fmvcf6 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-52-22-843Z-improver-bbzvg8 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-51-38-217Z-improver-9e1mv4 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-50-57-057Z-improver-3v3m9d failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-50-08-683Z-improver-7ydyg1 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-49-18-644Z-improver-d22p1b failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-48-28-706Z-improver-26oa60 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-47-31-617Z-improver-jiiyzo failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-46-40-799Z-improver-gp0zxl failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-46-05-058Z-improver-lg3eyq failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-45-17-585Z-improver-t8z371 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-44-42-078Z-improver-svp3v4 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-43-54-096Z-improver-vc2wdz failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-43-18-109Z-improver-5n391w failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-42-30-893Z-improver-n97mef failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-41-42-729Z-improver-ue3rmt failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-40-52-937Z-improver-jsxf09 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-40-01-000Z-improver-dtzkba failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-39-35-543Z-improver-ipbdeo failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-38-50-396Z-improver-4gfehx failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-37-47-721Z-improver-y5gkdz failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-37-09-877Z-improver-q5sl5o failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-36-20-539Z-improver-jp7hn3 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-35-46-162Z-improver-fedsa4 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-34-59-175Z-improver-hh48ef failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-34-02-499Z-improver-mxa011 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-33-05-520Z-improver-lpe8u3 failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-32-17-250Z-improver-nyrxjm failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-31-24-558Z-improver-r75jhz failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-30-07-323Z-improver-6mzalc failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T09-29-13-611Z-improver-ttqzqt failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.
- run 2026-08-05T07-44-52-890Z-improver-nhz0ks failed at step improve: Agent harness "codex" cannot honor requested run option(s): scopePolicy. scopePolicy: Codex CLI tool calls cannot be routed through KOTA's scope-policy evaluator.

## Desired Outcome

Repair the local workflow/runtime cause so the same pattern no longer
fires on fresh run artifacts. The fix may live in workflow code, repair
checks, validation, queue shaping, prompts, or local runtime handling, but
it should not hide the signal by broadening infrastructure exclusions
without evidence that the failure is actually outside KOTA's control.

## Constraints

- Use existing `.kota/runs/` metadata and run artifacts as evidence.
- Keep cost and throughput data out of autonomy-agent context.
- Do not create one task per run; keep this task anchored to the stable
  root-cause fingerprint above.
- Preserve provider/auth/rate-limit/timeout exclusions unless the local
  runtime handling is the defect being repaired.

## Product / Safety Link

Persistent monitored workflow failures are a runtime posture blocker:
autonomy cannot reliably ship or review Product/Safety work while this
root cause keeps recurring. This Meta repair is actionable only because
the detector crossed the local-code threshold on concrete run artifacts.

## Done When

- Fresh run artifacts no longer trigger this pattern fingerprint, or the
  threshold/classification is deliberately adjusted with a committed reason.
- Focused tests cover the local cause and the detector behavior that would
  have caught this recurrence.
- Operator-facing attention output still reports future escalations with
  the generated task id and without cost fields.

## Source / Intent

Auto-created by `workflow-failure-escalator` from recent workflow run
metadata. Persistent non-infrastructure workflow failures should become
one evidence-backed repair task instead of remaining only in digests or
improver context.

## Initiative

Autonomy fleet health: recurring local workflow failures should graduate
into deterministic, reviewable repair work.

## Acceptance Evidence

- Test output for the repaired workflow or runtime path.
- Detector test or run artifact showing this pattern no longer crosses the
  escalation gate on fresh evidence.
- Attention-event fixture or transcript showing any future escalation names
  the task id without cost fields.

<!-- workflow-failure-pattern-fingerprint: workflow-failure:consecutive-failures:improver:step-error:837684866e57 -->
<!-- workflow-failure-evidence-fingerprint: e30e38ebeb97ac26b9165ff366744d8dd64122913f613a0f22359eebd37de156 -->
