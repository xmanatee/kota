---
status: open
priority: p3
---
# Can KOTA verify a browser save after its notification disappears?

Explorer lead, September 21, 2026; a research question, not an observed defect.

[Agent-Computer Observation Interfaces](https://arxiv.org/pdf/2606.29472)
(June 28; sections 3, 6.6 and 9 read online today) separates observations
between actions from ordinary screenshots, retaining visual descriptions as
text. Its experiments also show that extra keyframes can hurt a model.
Controlled browser tasks, synthesized speech, single trials per configuration,
and potentially erroneous descriptions limit generalization. This motivates
checking what evidence reaches KOTA, not adopting continuous capture.
The [authors' repository](https://github.com/19PINE-AI/aoi) supplies code and
benchmark materials; neither was executed here.

A simpler comparison comes from Playwright's
[event guidance](https://playwright.dev/docs/events): subscribe before an
action to avoid missing its event. Its
[actionability checks](https://playwright.dev/docs/actionability) establish
readiness to interact; they do not establish an application's saved outcome.

Local relevance: `src/modules/browser/browser-interaction-tools.ts` returns
`Clicked: ...` after `page.click`. `browser-observation-tools.ts` offers
screenshots, current text and page JavaScript evaluation. Existing evaluation
could install a page-side observer or inspect durable state, so these source
facts do not establish a missing capability. The two tool-owner test files use
mocked pages and do not answer this end-to-end question.

Useful investigation: with an invented form in an authorized disposable browser
environment, compare a save that succeeds with one rejected through a brief
toast, then inspect whether KOTA verifies persisted state or accurately reports
uncertainty. Include a persistent-feedback control. Separate actual application
state, tool-visible evidence and the assistant's completion claim; distinguish
missed observation from failure to reason over available evidence. Trace existing
coverage and try supported tools before proposing another observation mechanism.
Retain a transcript or equivalent rendered evidence if an observation is run.

No external account, real submission, audio recording or persistent browser
profile is needed for this proposed comparison. The active profile-persistence
security task owns a different boundary. The archived browser-automation task
established interaction tools; it does not settle application completion after
transient feedback. Active document/workbook research concerns different
consumer journeys. No overlapping transient-browser-feedback task was found.

First determine whether this comparison exposes a useful gap or whether existing
tools and guidance suffice. No new runner, imported benchmark, continuous
recording service or implementation task is prescribed. No KOTA browser/model
observation ran in this discovery pass.

## Outcome And Acceptance

Determine whether existing KOTA browser assistance can distinguish a persisted
save from a rejected save after brief feedback disappears, or report uncertainty
accurately. No urgency was stated; p3 reflects exploratory work without a
demonstrated defect.

- Inspect maintained coverage, supported session/tool paths and available
  retained evidence before deciding whether a new observation is needed.
- If the question remains useful and unanswered, compare successful and rejected
  saves on an invented form in an authorized disposable environment, including
  persistent-feedback controls. Use existing supported tools first. Keep the
  application, model and relevant conditions comparable and attribute any changes.
- Separate independently verified application state, evidence actually returned
  to the model, and its completion claim. Retain a transcript or equivalent
  rendered evidence with the actual tools/model and feedback timing. Distinguish
  missed observation from misinterpretation of available evidence; a successful
  click alone does not establish a saved result. Keep observer-only ground truth
  out of the assistant's input.
- Record a grounded disposition: existing behavior suffices, no demonstrated
  gap, further observation is not justified with a reason, or a concrete
  deduplicated follow-up at the failing owner. If necessary observation requires
  unavailable capability, retain completed investigation and identify the exact
  external prerequisite under the task contract.

## Triage Provenance

Normalized from `data/inbox/task-verify-browser-save-after-transient-feedback.md`
on September 21, 2026, preserving the Explorer capture above. All four linked
sources were readable during triage. The paper's abstract and limitations,
repository README, and Playwright event/actionability guidance support the
research distinction; no external code or benchmark was executed.

Local inspection confirmed the click acknowledgement and current-page
observation tools described above, and mocked page boundaries in their two
owner test files. This is source evidence, not browser/model behavior. The active
queue scan found no task owning transient save feedback. The profile-persistence
security task concerns saving authenticated browser state, not saving form data;
it is not a hard predecessor for this disposable, unauthenticated comparison.
Document/workbook investigations likewise retain their separate journeys.

Coverage investigation can advance, so the task remains open. Other research
tasks' observation blockers are not inherited without assessing this task's
needs. No KOTA browser/model observation or behavioral test ran during triage.
