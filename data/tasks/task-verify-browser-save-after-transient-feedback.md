---
status: blocked
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

At triage, coverage investigation could advance, so the task remained open.
Other research tasks' observation blockers were not inherited. No KOTA
browser/model observation or behavioral test ran during triage.

## Investigation — September 21, 2026

Builder run `2026-09-21T09-26-00-554Z-builder-7l8pq9`, source
`973a0fcc893a87511fd6b8943bcb85e29735284d`, inspected the maintained browser
tools, session/lifecycle owner, native invocation transport, eval and parity
coverage, and available task-linked evidence. The exported issue evidence
contained an unrelated MiMo research run with unavailable run metadata, not a
browser-save observation. Archived automation and network-policy tasks supply
implementation history, not the required application/model comparison.

Findings:

- `browser_click` acknowledges completion of `page.click`; it does not inspect
  application persistence. `browser_get_text` and `browser_screenshot` expose
  current state. `browser_evaluate` can return page-side evaluation results,
  including a promise's result through Playwright. These afford a possible
  reload/readback or pre-action observer strategy; whether assistance chooses
  and interprets one correctly remains unmeasured.
- Browser tools are registered in the browser module and require an active
  session, scope identity and scope root. `kota run` is the existing assistant
  entrypoint. Browser tools do not opt into `nativeInvocation`; the native
  workflow request/reply service cannot call them directly. The existing
  `kota eval contained` service is the supported route to host-authorized
  contained execution. A source-access report exercises article/X readers,
  not an assistant save interaction.
- The interaction and observation suites mock `getPage`. The research-collection
  integration journey controls the browser process/DOM and tests collection,
  policy and publication. The inspected eval fixtures and harness-parity
  scenarios contain no transient-save comparison. None establishes a save
  completion claim after feedback disappears.
- `pnpm test:owner src/modules/browser/browser-interaction-tools.test.ts
  src/modules/browser/browser-observation-tools.test.ts` passed: 21 tests in
  two files. This confirms existing acknowledgement, observation serialization,
  error and session-routing behavior at mocked page boundaries; it is not
  browser/model acceptance evidence.

Execution readiness was assessed for this task, independently of the workbook
and profile-persistence tasks. A disposable Node invocation imported Playwright
successfully and attempted the production `launchBrowserProcess` with the
default public-untrusted profile, headless mode and persistence disabled.
Its required proxy failed before Chromium launch with
`Error: listen EPERM: operation not permitted 127.0.0.1`.
No navigation, form submission, persistent profile, or model call occurred.
This establishes a sandbox restriction, not host browser or credential absence.

The authorized alternative, `pnpm kota eval contained
'{"operation":"inspect"}'`, reached the host request/reply service and returned
`is_error: true`: `Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`.
No host execution profiles were available through that service. The worker
cannot provision that trusted grant. No authority, proxy, persistence or daemon
controls were changed.

Disposition: **the question remains useful and unanswered; blocked on execution
access or equivalent attributable evidence below**. There is no demonstrated
observation or reasoning defect and no basis for adding continuous capture,
changing prompts, or creating an implementation follow-up. Existing source
affordances and passing mocked tests do not justify claiming assistance suffices.
Application ground truth, model-visible results and completion claims are all
unobserved in this run. The original research citations remain provenance;
they were not re-read or used as new behavioral proof.

Selected commands, results and the launch reproducer are retained in this run's
`artifacts/browser-save-investigation.md`. The only repository change is this
task's investigation and blocked disposition; production behavior is unchanged.

## Source retry — September 21, 2026

Collector `2026-09-21T09-35-28-963Z-research-source-collection-t3mxqz`
attempted the four citations with `web_fetch` at 09:37:22–23 UTC. This
assessment uses its supplied readings; no additional source calls, browser/model
comparison, or execution-readiness probe ran in this retry.

- The [paper](https://arxiv.org/pdf/2606.29472) returned only
  `Binary content: application/pdf (827.7 KB)` and a download suggestion, marked
  as an error. No paper text was available in this attempt. This is a binary
  handling limitation in the collected reading, not evidence of an auth wall,
  rate limit, missing paper, or irrecoverability. Earlier recorded readings
  remain historical provenance.
- The [repository README](https://github.com/19PINE-AI/aoi) was readable. It
  describes inter-action keyframe capture and persistent visual narration,
  includes transient UI tasks, and cautions that component benefits vary by
  model. This supports investigating lost feedback but does not establish a
  KOTA defect or justify adopting continuous capture. Code, benchmark tasks,
  and results files were not inspected or executed in this retry.
- The [event guidance](https://playwright.dev/docs/events) was readable. Its
  examples register waits before triggering actions and describe event
  listeners. This supports the existing pre-action observation candidate;
  whether KOTA assistance uses it successfully remains unobserved.
- The [actionability guidance](https://playwright.dev/docs/actionability) was
  readable. It describes interaction-readiness checks and retrying assertions.
  For this task, readiness to click supplies no evidence that the application
  persisted the requested value; the comparison still needs outcome readback
  or another supported observation and an attributable completion claim.

Disposition: retain `blocked` on the existing operator-capture prerequisite.
Readable citations do not supply the missing application state, model-visible
evidence, or assistant claim. The PDF's unread text in this attempt does not
replace that execution blocker. No inbox status or prior investigation result
changes, and no implementation follow-up is justified by these readings alone.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An authorized disposable KOTA browser/model comparison of successful and rejected saves with transient and persistent feedback, or equivalent attributable session evidence.

The path is a discovery hint, not a required capture directory. Resume when an
authorized environment can run an actual KOTA browser-enabled session with
Chromium and its required proxy, or an equivalent session export is available.
For the contained route, an operator-owned profile must authorize this scope
and comparison, provide browser/model dependencies and permitted provider
egress, and allow the disposable application's origin through the browser's
existing network policy. See `src/modules/eval-harness/contained-evaluation.md`.
An arbitrary offline test profile or configuration alone is not live proof.
No external account or persistent login profile is needed. Do not bypass the
proxy, expose host authority to candidate code, or restart the parent daemon.

On resumption, use the same invented form, request, actual model/harness and
tool policy across a two-by-two comparison: accepted/rejected save, each with
brief/persistent feedback. For example, change an initial saved value `draft`
to `revised`; acceptance persists `revised`, rejection retains `draft`.
Keep the outcome selection and independently inspected backing state outside
the assistant's input. A normal user-facing reload/readback may expose saved
state through existing tools. Record the actual toast duration and elapsed
time to each observation, ensuring post-action observation in transient rows
occurs after dismissal. Retain every tool input/result and final assistant
response, plus separate observer ground truth; attribute any prompt, tool,
timing or application changes instead of pooling unlike trials.

Judge confirmed persistence, correctly detected rejection and explicit
uncertainty separately. A filled field or `Clicked:` acknowledgement is not
saved-state evidence. If the assistant receives decisive rejection/readback
evidence but claims success, classify interpretation failure; if the evidence
has disappeared and no durable result is inspected, classify missing
observation and assess whether the assistant honestly reports uncertainty.
Try existing evaluation/readback or pre-action observation before proposing a
new mechanism. One successful small comparison would establish feasibility
under its recorded conditions, not reliability across arbitrary applications.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T09:34:57.007Z -->

<!-- research-retry-attempt: {"fingerprint":"c2104052e7f82d9e","attemptedAt":"2026-09-21T09:37:23.699Z","attempts":[{"url":"https://arxiv.org/pdf/2606.29472","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T09:37:22.978Z","tools":["web_fetch"],"outcome":"unavailable"},{"url":"https://github.com/19PINE-AI/aoi","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T09:37:23.630Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://playwright.dev/docs/events","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T09:37:23.679Z","tools":["web_fetch"],"outcome":"readable"},{"url":"https://playwright.dev/docs/actionability","accessFingerprint":"9de0236be976b5fc","attemptedAt":"2026-09-21T09:37:23.699Z","tools":["web_fetch"],"outcome":"readable"}]} -->
