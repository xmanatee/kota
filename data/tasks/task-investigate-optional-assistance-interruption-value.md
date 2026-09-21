---
status: blocked
priority: p3
---
# When is an optional suggestion worth interrupting the user?

Explorer discovery, September 21, 2026.

[Proactive Service Agents](https://arxiv.org/html/2609.03727v1), a September 3
survey read online today (sections II, IV and VI), distinguishes silence,
questions, suggestions and external actions. It recommends evaluating complete
streams of decision opportunities, including occasions when help is unnecessary,
and warns that acceptance observed only after intervention cannot establish its
benefit over silence. This is a research framework, not a demonstrated KOTA
improvement or a validated implementation to adopt.

KOTA question: after completing a requested task, when should an assistant
surface an optional related suggestion, and when should it simply finish?
A hypothetical example is offering meeting preparation after answering a
schedule question. Correctly remembering the meeting does not establish that
the extra interruption is useful. This is not an observed product defect.

The existing `task-investigate-correction-reuse-in-later-assistance` owns whether
stored corrections affect later responses; do not duplicate its live comparison
or blocked setup. The archived proactive intent-resolution task covered hidden
intent and authorization. Its tests were subsequently retired, as documented in
the active correction task; that history proves neither current timing quality
nor a need to restore those tests. Scheduled reminders and required approvals
also have different contracts from optional suggestions.

Worth investigating: can attributable KOTA interactions identify a recurring
optional-interruption problem, and would a matched comparison of suggesting,
asking and finishing measure user benefit and burden? Keep the requested task
and available context comparable. Use existing session and evaluation owners;
do not prescribe a new proactive loop, notification policy or benchmark fixture
before establishing a useful product decision. No external messages, model
comparison or user study was performed in this exploration.

## Research Outcome And Acceptance

Determine whether attributable KOTA interactions justify changing when optional
related assistance is offered after a requested task is complete. This is a p3
research lead with no stated owner urgency, not a confirmed defect.

- Inspect available transcripts, operator corrections and maintained coverage
  for recurring unwanted suggestions or missed useful assistance. Cite actual
  interactions and distinguish observed outcomes from hypothetical examples.
- Identify whether that evidence supports a concrete model/prompt decision.
  If a comparison would resolve it, keep the requested task, context, model and
  execution conditions comparable across suggesting, asking and simply
  finishing. Include opportunities where extra help is unnecessary; distinguish
  task benefit from question burden, rejection and interruption. Do not infer
  benefit over silence from suggestion acceptance alone.
- Record an evidence-grounded disposition: no demonstrated need for change,
  sufficient existing coverage, or a concrete deduplicated follow-up tied to
  the observed problem. State evidence limits; no new fixture, proactive loop
  or notification policy is required to complete this investigation.

Use existing session and evaluation owners. Do available evidence review first;
the correction-reuse task is related work, not a hard predecessor. If a necessary
observation requires unavailable authorized capability or operator evidence,
record that specific prerequisite under the normal blocked-task contract rather
than duplicating setup work or importing another task's blocker. This task does
not authorize unsolicited external messages or a user study.

During September 21 inbox triage, the linked survey was readable and its
decision-opportunity and selective-feedback discussion was checked. No KOTA
interaction review or comparison was performed during triage. The original
capture's research question remains open.

## Evidence Review — September 21

Assessed repository revision `bf79d33ddeef720039f6e5d9dce30b0ae839f59e`
in builder run `2026-09-21T03-47-55-137Z-builder-5oa8ec`.

The available material does not establish recurring unwanted suggestions or
missed useful assistance. It also cannot establish satisfactory timing: no
eligible user/assistant interaction was available for assessment.

- The supplied `agent/issue-evidence.json`, captured at
  `2026-09-21T03:49:44.685Z`, contains an empty evidence array. The writer has
  no `.kota` directory. Listing canonical `.kota/history` and `.kota/runs`
  returned `Operation not permitted`; that says nothing about their contents.
- The existing runtime-mediated native invocation service was queried with
  `conversation_recall`, input `{"action":"list","limit":30}`. It returned
  `is_error: true`, `Tool is unavailable through native invocation.` This is
  an unavailable inspection route, not an empty-history result or a claim that
  the host lacks credentials. No authority or history configuration was changed.
- Current inbox contains only its guidance file. Inspected search results from
  active and archived task records contained hypotheses and adjacent runtime work,
  not a cited completed request followed by optional assistance and user feedback.
  These keyword searches are discovery aids, not a representative usage sample.
- The retained `src/modules/codex-agent-harness/reference-evidence/`
  `capability-integration-20260826/transcript.txt` records a
  `pnpm kota doctor --preset codex --skip-connectivity` result. It is an actual
  diagnostic transcript, not a conversational suggestion opportunity; its health
  warnings cannot be counted as unwanted assistance or current host readiness.

Maintained coverage has narrower contracts:

- `src/modules/history/conversation-recall.test.ts` covers search, limits,
  prefix resolution and bounded rendering through the real history store.
  Its authored messages do not measure user benefit or interruption burden.
- `src/conversational-agent-tools.integration.test.ts` drives real stores with
  a scripted model, including an authored `all done` final reply. It proves
  capture/recall/answer/retract composition, not a model's choice to finish.
  `src/recall-answer-pipeline.integration.test.ts` covers synthesis/citation
  handling with controlled contributors and synthesis, not suggestion timing.
- Git confirms that `7cecbcb0153f1d7e02e9a8ed6b6d588553f2a6b4` deleted the
  historical proactive intent-resolution test. Its parent version's
  `createCorrectPlan` supplies literal actions and a literal final response.
  Hidden-intent and authorization predicates neither compare optional
  suggestions with silence nor justify restoring that test.

These are source inspections, not newly executed behavioral tests. The linked
survey was freshly readable: sections III-D and IV distinguish selective
feedback, complete decision opportunities and user burden. It offers comparison
design guidance, not a KOTA outcome or a threshold to adopt.

## Blocked on

kind: operator-capture
path: .kota/history/
description: A scope-authorized read/export of attributable KOTA conversations containing completed requests, optional-assistance opportunities and available subsequent user feedback, or equivalent retained interaction evidence.

The path is a discovery hint, not a required capture location. Existing history
and session owners should supply an authorized view or screened export with
session/turn identity, chronology, original request and available context,
assistant response and observed follow-up. Include ordinary completions as well
as suggestions and questions; preserve missing feedback as unknown. Do not
collect only accepted suggestions. This prerequisite is interaction evidence,
not the correction-reuse task's contained model-execution setup. No new setup
task, external message, user study or live model comparison is requested here.

Resume by reviewing that evidence for a recurring problem. If it supports a
specific prompt/model decision, compare suggesting, asking and finishing with
the same requested task, prior context, model version, prompt baseline, tool
permissions and execution conditions, varying the optional-assistance choice.
Include unnecessary-help opportunities. Assess task benefit separately from
question turns, rejection/ignoring, time to resume and reported interruption;
label simulated or evaluator judgments separately from observed user outcomes.
Acceptance alone cannot establish benefit over silence. No such comparison ran.

The unresolved acceptance is the attributable interaction review and consequent
product disposition. No defect, sufficient timing coverage or implementation
follow-up is established. Retained changes are limited to this task's findings
and blocked state; runtime behavior is unchanged. Collection provenance is in
this run's `agent/optional-assistance-review.md`. The task validator checks the
edited queue contract; it cannot settle the research question.
