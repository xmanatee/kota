---
id: task-run-shadow-semantic-reviewers-for-non-builder-auto
title: Run shadow semantic reviewers for non builder autonomy workflows
status: ready
priority: p1
area: autonomy
task_class: Meta
depends_on: [task-add-loop-quality-audits-for-autonomous-workflows, task-add-measured-autonomy-change-promotion-decisions]
summary: Evaluate candidate critic or semantic-review gates for decomposer, explorer, inbox-sorter, research-retry, and security-review in advisory shadow mode before making any new reviewer blocking.
created_at: 2026-06-25T14:51:40.532Z
updated_at: 2026-07-07T06:33:13.242Z
---

## Problem

Builder has the clearest critic/improver path today. Other autonomy workflows,
including decomposer, explorer, inbox-sorter, research-retry, and
security-review, rely more heavily on deterministic checks, local AGENTS
instructions, task validation, or final operator review. The owner's concern is
valid: AI-authored work benefits from independent review, especially when the
workflow can create tasks, update source-derived knowledge, classify queue
items, or issue security recommendations.

The wrong fix is to put the builder critic everywhere. Public multi-agent
guidance consistently warns that cross-agent context passing, write-heavy
coordination, and vague reviewer scopes create overhead and false confidence.
KOTA needs to evaluate reviewer candidates per workflow, using artifact-only
inputs and shadow-mode measurement before making any new reviewer blocking.

## Desired Outcome

Add advisory shadow semantic-review support for selected non-builder autonomy
workflows. In the first version, a workflow can declare a review target
resolver and a reviewer profile. After the workflow succeeds, KOTA can write a
shadow review artifact without changing the workflow's pass/fail result.

Representative review targets should include:

- decomposer: created task set, dependencies, duplication posture, and whether
  implementation-ready slices preserve owner intent;
- explorer/inbox-sorter: queue moves, priority/classification rationale,
  stale-blocked handling, and AGENTS/task-format compliance;
- research-retry/watchlist maintenance: source-to-local-decision mapping,
  duplicate task avoidance, and rejection/adoption rationale;
- security-review: evidence-backed findings, severity, revalidation command,
  and whether the recommendation changes product or safety posture; and
- PR or commit support surfaces: diff-to-summary alignment and missing test or
  verification evidence.

Shadow review output should include reviewer decision, cited artifacts,
findings, false-positive annotations when later known, cost/duration for the
operator report, and a promotion candidate reference for the measured autonomy
decision artifact.

## Constraints

- Do not add a universal critic wrapper. Each workflow must declare the
  artifact it wants reviewed and the question the reviewer is allowed to answer.
- Do not reuse builder critic prompts blindly. Builder's review task shape is
  not the same as inbox sorting, research synthesis, or security assessment.
- Start advisory only. A reviewer becomes blocking only after measured evidence
  shows it improves the target workflow under the autonomy-change decision
  process.
- Keep reviewer input artifact-only. Do not pass hidden reasoning, broad
  conversation state, or unrelated local files into the reviewer.
- Keep deterministic validators as the first line of defense for schema,
  dependency, directory, and task-format mistakes.
- Preserve human-in-the-loop gates for irreversible, credentialed, destructive,
  or policy-sensitive effects. A reviewer is not a replacement for approval.
- Track cost and latency only in operator-visible artifacts and reports.

## Done When

- A reviewer declaration/protocol exists for non-builder autonomy workflows,
  including target resolver, reviewer prompt/profile, output schema, and
  shadow/advisory/blocking mode.
- At least two representative workflows have shadow reviewers wired in with
  focused fixtures. One should be task/queue-shaped, and one should be
  research, security, or source-decision shaped.
- Shadow review artifacts are included in the operator report with catches,
  false positives when annotated, skipped target-resolution cases,
  cost/duration, and run references.
- Tests cover target resolution, skipped reviews, malformed review artifacts,
  no hidden-context leakage, and advisory mode not changing workflow outcome.
- Promotion to a blocking reviewer requires an
  `autonomy-change-decision` artifact rather than a prompt-only instruction.

## Source / Intent

Owner asked whether all agents have a critic and whether KOTA should add
professional, unbiased review beyond builder. The answer from local inspection
and external research is: yes, more independent review is useful, but only when
the review target and promotion criteria are explicit.

Research synthesis:

- Anthropic's multi-agent research-system writeup says multi-agent approaches
  work best for breadth-first, read-heavy work and add observability and
  coordination complexity.
- Cognition warns against splitting write-heavy coding work across agents
  without shared context and clear ownership.
- LangChain's multi-agent guidance emphasizes context engineering and durable
  traces/evals before adding more agents.
- Google's ADK guidance distinguishes sub-agents from agents-as-tools; KOTA's
  reviewer shape should be an explicit tool/sub-agent choice per workflow, not
  a blanket graph.
- OpenAI's guardrails and approvals guidance supports separating automated
  guardrails from human review for high-risk actions.

Local mapping:

- `task-add-loop-quality-audits-for-autonomous-workflows` covers deterministic
  loop rails and verifier expectations.
- `task-record-autonomy-review-scrutiny-metrics` already counts thin approvals
  across existing reviewer artifacts.
- This task fills the missing experimental path for non-builder semantic
  reviewers while avoiding an unmeasured critic explosion.

## Initiative

Measured multi-agent review.

## Product / Safety Link

Safety: adds independent review for non-builder workflows that can create,
move, classify, or recommend work, while keeping reviewer promotion measured
and advisory first. The safety outcome is fewer unchecked queue/research/security
decisions without introducing an unmeasured universal critic.

## Acceptance Evidence

- Diff showing the non-builder reviewer declaration/protocol and at least two
  workflow integrations.
- Focused test transcript covering advisory shadow review behavior and target
  resolution.
- Sample `.kota/runs/<run-id>/shadow-review/*.json` artifacts plus report
  output showing reviewer findings without blocking the original workflow.
