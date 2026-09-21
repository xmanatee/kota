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
