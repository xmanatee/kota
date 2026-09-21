---
status: blocked
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

At triage this task stayed open because coverage and consumption-path investigation
could advance. The correction-reuse task's observation prerequisite is unchanged and
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

## Investigation And Disposition — September 21

Builder `2026-09-21T05-26-43-024Z-builder-0wjdma` inspected source revision
`74ab423fecb7111bc1d6b3a8eb0ca72256d2b754`. No demonstrated product gap;
the model-dependent question remains unanswered, so this is not a completion
claim. Completed source and coverage investigation is retained below. No
production code, prompt, model, store or permanent fixture changed.

- Supported conversational consumption runs through `AgentSession.send` and
  `src/core/loop/loop-send.ts`: admitted dynamic recall guidance, model-selected
  tool calls, shared tool execution, `Context.addToolResults`, then the next
  `streamMessage` call. HTTP chat returns the session's actual text. This is
  distinct from the answer module's citation-oriented synthesis path.
- Recall resolves the selected scope and store, ranks results and renders
  memory previews. Downstream `tool-runner-execution.ts` truncates results and
  `secret-masking.ts` masks known secret values in text, blocks and structured
  content. `config/secrets.ts` obtains those values from registered secret
  stores; this is not a query-conditioned personal-detail policy. Injection
  defense annotates selected untrusted tool outputs without deleting payloads;
  recall is not in its default target list. Configured middleware may differ.
- Evidence-policy projection scrubs sensitive fields/text, including email,
  at its own durable-evidence/client boundaries. The traced conversational
  tool-result path does not invoke that projection as a universal recall
  filter. Age-based observation masking and compaction manage context size;
  they do not establish appropriate omission from the first draft. These are
  source findings, not observations of a private value reaching a live model.
- Maintained `conversational-agent-tools.integration.test.ts` checks real
  stores and model-visible tool results with a scripted ModelClient and
  synthesizer. `recall-answer-pipeline.integration.test.ts` likewise uses a
  deterministic synthesizer. Recall owner tests cover ranking, filters,
  rendering and provenance/retraction; the archived scope and retention work
  addresses other boundaries. `preset-parity-fixture.integration.ts` queries
  a seeded nonce through capture/recall/answer, not a paired introduction.
  None of this inspected evidence establishes spontaneous preference use
  with omission-versus-requested-inclusion. Tests were inspected, not rerun.
- The supplied `agent/issue-evidence.json`, captured at
  `2026-09-21T05:26:48.106Z`, contains one unrelated MiMo source-publication
  record with no writer evidence and unavailable metadata. The writer has no
  `.kota/runs` directory. No attributable drafting comparison was available
  in those materials; this does not assert that none exists elsewhere.

A matched observation is worthwhile: it distinguishes successful selective use
from absent retrieval and from overbroad masking that also prevents authorized
inclusion. It requires actual session outputs, not another deterministic scorer
or a source-only inference. This run independently queried the existing native
host service with `pnpm kota eval contained '{"operation":"inspect"}'`.
It returned `is_error: true`, exit 1, and
`Set KOTA_EVAL_CONTAINED_PROFILES in the trusted host environment`.
No configured profile was exposed through that surface. This is a host grant
prerequisite, not inferred credential/model absence or an inherited blocker.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An applicable host-authorized isolated KOTA execution profile for the paired personal-memory drafting observation, or equivalent attributable session and store/recall evidence.

The path is an evidence-discovery hint, not a required capture directory. Resume
when the host supplies applicable scope-authorized capability through existing
contained-evaluation setup, or equivalent evidence through an authorized export.
Profile configuration alone is not acceptance; it must support the ordinary
session/capture-or-memory/recall journey and retain actual model input/output.

Use invented records (a concise-message preference and a fictional contact
detail), saved through normal owners in an isolated scope. Start both arms
from the same stored records and fresh comparable sessions, with the same
model, instructions, tools and retrieval backend. Compare a routine local
introduction with the same request explicitly asking to include the saved
contact detail; that request supplies consent without another confirmation.
Retain saved records, actual queries/hits, post-processing model-visible
context, drafts and execution provenance, with no external send. Assess useful
style use separately from exact contact inclusion. A short draft alone does
not prove preference reuse; a retrieval hit does not prove output disclosure;
an omitted exact value does not prove absence of inference, paraphrase or
re-identification. A masked export alone cannot establish what the model saw.

No matched model observation ran. No failing owner or implementation follow-up
is justified yet. The correction-reuse task and existing external-pattern
decisions remain unchanged. Run-local source/probe provenance is retained in
`agent/personal-memory-investigation.md` and `agent/contained-inspect-result.json`.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T05:36:04.324Z -->
