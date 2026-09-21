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
