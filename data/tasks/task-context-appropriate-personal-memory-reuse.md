---
status: open
priority: p3
---
# Can KOTA reuse personal preferences without disclosing unrelated details?

Explorer discovery, September 21, 2026. Research lead, not an observed defect.

[SP-Mem](https://arxiv.org/html/2608.16551v1), submitted August 17 and read
online today, separates searchable sanitized memories from exact private values
and restores values according to task need and consent. Its evaluation separates
useful personalization from unnecessary disclosure. Appendix A limits the
evidence to synthetic interactions and exact-value exposure; it does not establish
protection against inference or re-identification. The
[project README](https://github.com/Jensassss/SP-Mem) describes an explicit
consent continuation and an exact-match scorer. Neither implementation nor
benchmark was executed here.

[MemGate](https://arxiv.org/html/2606.06054v1), submitted June 4 and read online
today, instead places a query-conditioned learned gate between memory retrieval
and the model. It motivates distinguishing semantic relevance from appropriate
use. Its reported results on other systems do not establish KOTA behavior or
justify adopting that gate.

Open product question: after saving a preference for concise messages and a
personal contact detail, can KOTA draft a routine introduction using the style
preference without including the contact detail unless requested? Compare with
an explicit request to include that detail in a local draft. This is a hypothetical
same-scope example with invented data and no external send. Respect authorization
already expressed in the request; this lead does not propose another confirmation
step for authorized work.

Local relevance: `src/modules/recall/contributors.ts` projects memory content
into previews; `recall-provider.ts` resolves scope and ranks source batches.
Those inspected paths motivate the question but do not establish a disclosure
failure or characterize all downstream controls. Before promoting this lead,
trace the current answer/session consumption and existing privacy policy.
Archived `task-add-retention-redaction-and-provenance-policy`,
`task-project-scope-recall-answer-capture-retract-pipelines`, and
`task-add-interference-heavy-recall-eval-fixture` cover adjacent concerns; their
historical acceptance does not answer this particular user journey.

The active `task-investigate-correction-reuse-in-later-assistance` concerns
whether a correction is used later. Keep its observation prerequisite intact;
this lead asks when available information should be omitted. Determine first
whether maintained evidence already answers it, then whether an authorized
observation is worthwhile. Any comparison should distinguish retrieved context,
draft content, useful preference use, and unnecessary disclosure. No new store,
imported benchmark, learned filter, or permanent fixture is prescribed. Existing
Letta/Hermes and Reflexion/ReasoningBank decisions remain unchanged.

## Research Outcome And Acceptance

Determine whether current KOTA assistance can use a saved style preference while
omitting an unrelated personal detail, and still include that detail when the
user explicitly requests it. No urgency was stated; this is p3 exploratory work,
not a confirmed privacy defect or an implementation mandate.

- Inspect maintained coverage and available retained evidence for the same-scope
  drafting journey. Trace the actual supported session path and relevant privacy
  controls, including any tool-result processing after recall. Historical task
  completion and source-level preview construction alone cannot settle behavior.
- If evidence is insufficient, assess whether an authorized observation is
  worthwhile. Use invented information through normal capture/memory and recall
  owners, then compare a routine introduction draft with an explicit request to
  include the contact detail. Keep prior state, model and relevant conditions
  comparable; no external send or real personal data is needed. Respect consent
  already expressed by the request, without adding a confirmation step.
- Distinguish stored records, retrieved/model-visible context, actual draft
  content, useful preference use and unnecessary disclosure. Retain an
  attributable transcript or equivalent product evidence. A safe draft does not
  prove that no private value reached the model; a retrieval hit alone does not
  prove disclosure in the draft. State the limits of any exact-value check.
- Record an evidence-grounded disposition: existing behavior suffices, no
  demonstrated gap, observation is not justified with a reason, or a concrete
  deduplicated follow-up for the failing owner. If necessary observation requires
  unavailable capability, retain completed investigation and identify the
  specific external prerequisite using the task contract.

This task stays open because coverage and consumption-path investigation can
advance. The correction-reuse task's observation prerequisite is unchanged and
is not a hard predecessor. Do not inherit its blocker without assessing the
capability needed here. No new store, learned gate, runner, imported benchmark,
or permanent evaluation fixture is prescribed.

## Triage Findings And Provenance

Normalized from `data/inbox/task-context-appropriate-personal-memory-reuse.md`
on September 21, 2026. The three source URLs above were readable during triage.
SP-Mem's abstract, partitioned-storage design and Appendix A, its README's
consent continuation and exact-match scoring, and MemGate's query-conditioned
embedding gate support the research distinctions in the capture. These readings
supply no KOTA measurement; neither external implementation nor benchmark ran.

The active queue has no task owning this omission-versus-requested-use question.
The correction-reuse investigation concerns later use of corrections; the
archived scope-pipeline task concerns separation between scopes; the archived
interference task concerns current versus stale project decisions. The archived
retention task is adjacent policy work. None of those contracts alone establishes
this same-scope drafting outcome.

Limited local source tracing found:

- `src/modules/recall/contributors.ts` constructs memory previews from clipped
  record content. `tool.ts` returns the shared rendering, whose memory branch
  in `render.ts` includes the preview. `system-prompt.ts` encourages admitted
  sessions to recall relevant stored facts. This identifies a session-facing
  consumption path, not a completed model observation.
- `src/modules/answer/answer-provider.ts` passes recall hits to synthesis;
  `synthesis-prompt.ts` places memory previews in the supplied source snippets.
  The answer module owns citation validation and persistence. Its short cited
  answer path is distinct from an ordinary drafting session and must not be
  substituted for that journey without stating the difference.
- `src/core/evidence/AGENTS.md`, `policy-model.ts` and `policy.ts` own typed
  retention and redaction for durable evidence and client projections. Their
  artifact/target policies and sensitive-field/text scrubbing are relevant
  existing controls; their existence does not establish query-appropriate
  personal-memory use in a draft. Reuse that owner where applicable rather than
  assuming it must be duplicated or that it already governs every recall result.

No KOTA draft, model comparison or behavioral test ran during triage. Downstream
session processing and maintained behavioral evidence remain investigation work;
no disclosure failure, comprehensive absence of controls, or adoption decision
is claimed.
