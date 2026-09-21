---
status: blocked
priority: p3
---
# Can KOTA return the file produced by a browser export?

Explorer lead, September 21, 2026. This is an unresolved capability question,
not an observed failed KOTA session or a request to adopt another browser runtime.

An assistant asked to export a report should return the actual, complete file
at an authorized destination, including after its browser session closes.
Clicking Export alone does not establish that outcome.

Primary sources read online today:

- [Playwright downloads](https://playwright.dev/docs/downloads) registers the
  download wait before clicking and warns that closing the context deletes
  its temporary downloads.
- [Download API](https://playwright.dev/docs/api/class-download) distinguishes
  the start event from completion, supports failure/cancellation and streams,
  and waits for completion when saving. The suggested filename comes from
  response headers or the page's download attribute.
- [Browser Harness](https://github.com/browser-use/browser-harness) presents
  browser file retrieval as a user journey and agent-written helpers as its
  approach. This is a peer example, not reproduced performance evidence.
- [Playwright evaluation](https://playwright.dev/docs/evaluating) separates
  page JavaScript from the controlling process. Page evaluation is not direct
  access to Playwright's download objects.

KOTA already offers `web_fetch` and `http_request` with `save_to`; ordinary
downloadable URLs should use those existing owners. Its browser page port
(`src/modules/browser/playwright-loader.ts`) and registered tools expose no
download event/handle. `browser_evaluate` runs in the page and truncates returned
text after 20,000 characters. It may still support a small export through
page-side extraction and an authorized file write; that alternative has not
been tested. Missing a dedicated tool does not prove the user outcome impossible.

The useful comparison is an ordinary URL download versus a browser-generated
Blob or session-bound export, using invented report data and checking exact
bytes at the destination after browser close. Can existing tools complete both
without copying credentials into agent context, reconstructing a truncated
payload, or falsely reporting success on cancellation? If they can, retain that
route. If they cannot, identify the missing boundary and smallest browser-owned
capability, preserving existing network policy, effect authorization and file
destination confinement. Treat page-suggested names as untrusted metadata.

No browser/model trial or peer installation was performed. Any later execution
needs the normal authorized browser/model environment; this capture does not
authorize host setup or profile access. Keep this separate from the existing
transient-save-feedback task (application persistence), browser-profile task
(credential persistence), and workbook-edit task (document integrity).

## Research Outcome And Acceptance

Determine whether supported KOTA assistance can deliver a complete browser
export to an authorized file destination and accurately report the result.
No urgency was stated; p3 reflects an exploratory question without a
demonstrated failure.

- Inspect maintained coverage and retained evidence for file delivery through
  the current browser and web-access owners. Establish whether existing routes
  already answer the question before proposing a new mechanism.
- If observation is useful and needed, compare an ordinary downloadable URL
  with a browser-generated Blob or session-bound export using invented report
  data in an authorized disposable environment. Try supported tools first;
  retain a usable route if it suffices. Include a payload beyond the page
  evaluation text limit and a failed or cancelled export so a small success
  cannot conceal truncation or false completion.
- Check exact output bytes at the authorized destination after browser close.
  Retain the actual session/tool transcript, assistant completion claim and
  independently checked file result, with model/tool and environment provenance.
  Distinguish transport feasibility from demonstrated assistant behavior.
  Preserve network policy, effect authorization, destination confinement and
  credential confidentiality; suggested filenames confer no path authority.
- Record a grounded disposition: existing behavior suffices under stated
  conditions, no demonstrated gap, further observation is not justified with a
  reason, or a concrete deduplicated follow-up at the failing owner. If needed
  observation cannot run, retain the investigation and identify its specific
  external prerequisite using the blocked-task contract. No replacement browser
  runtime, new runner or permanent fixture is prescribed.

## Triage Provenance — September 21, 2026

Normalized from `data/inbox/task-return-browser-generated-export.md`, preserving
the Explorer capture above. All four linked sources were readable during
triage. The Playwright download lifecycle, completion/failure API and evaluation
environment distinction support the proposed comparison. Browser Harness's
README supplies a download example and editable-helper approach, not reproduced
performance evidence. No peer installation or browser/model trial ran.

Local inspection confirmed that `src/modules/browser/playwright-loader.ts` has
no download event/handle in its page port, `index.ts` registers no download tool,
and `browser-observation-tools.ts` truncates evaluation output at 20,000
characters. `src/modules/web-access/web-fetch.ts` and `http-request.ts` expose
`save_to`. These are source findings, not proof that export delivery is
impossible or that page-side extraction works.

The active queue has no task owning this file-delivery outcome. The transient
save-feedback, profile-persistence and workbook tasks retain their distinct
contracts. Their observation prerequisites are not hard predecessors here.
Coverage and supported-route investigation can advance, so this task starts
open; execution readiness must be assessed for the route actually needed.

## Investigation — September 21, 2026

Disposition: **insufficient evidence; browser/model observation needs an
authorized environment or an equivalent attributable session export**. No
browser-export defect or successful assistant delivery has been demonstrated.
Retain the existing routes; a new download tool is not yet justified.

Source inspected at `c2b8f0d7bb7752f3f5e9d496f06926bfabdac350`:

- `web-access/web-fetch.ts` and `http-request.ts` save complete bounded
  responses before reporting success. With `save_to`, `max_length` and
  `max_response_length`, respectively, are byte budgets, defaulting to 20,000;
  large exports need an explicit sufficient budget within transport limits.
  Binary responses preserve bytes; text responses decode and re-encode UTF-8,
  so this is not an arbitrary-encoding fidelity guarantee. Neither runner
  reads browser cookies. `http_request` can save an HTTP error body while
  returning `is_error: true`; a saved path alone does not establish success.
- `web-access/save-path.ts` confines destinations to the scope. Its resolver
  also supplies registered filesystem mutation targets for authorization.
  The shared outbound transport accepts HTTP(S), not Blob URLs, and retains
  public-network restrictions. A private disposable server therefore cannot
  be substituted into the ordinary URL arm by disabling those restrictions.
- `browser/playwright-loader.ts`, `index.ts`, and the interaction/observation
  tools expose no download handle, completion wait, or file-save action.
  Click success only establishes the click. Evaluation returns page values,
  marking output over 20,000 characters as truncated, without setting
  `is_error`. `file_write` accepts a string and writes UTF-8. Extracting small
  page-accessible text and writing it is a plausible supported composition;
  bounded extraction of a retained large Blob is also a hypothesis, not a
  demonstrated route. Neither permits treating a truncated response as a file.
  Actual browser downloads and arbitrary binary exports remain unmeasured.

Paths above are under `src/modules/` unless described as core. Browser actions
retain their declared external-effect authorization and session-specific
network proxy. Suggested names supply no destination authority. This
investigation changed no production policy, tools, profiles, or credentials.

Bounded searches of browser/web-access coverage, active and archived tasks,
inbox, eval fixtures and harness-parity found no attributable complete browser
export journey. The supplied `issue-evidence.json` contains an unrelated MiMo
research mutation with unavailable run metadata. This does not establish that
no historical user session has ever delivered a file; private conversation
stores were not read. Adjacent workbook, profile and save-feedback tasks do
not supply this missing observation.

The [download guide](https://playwright.dev/docs/downloads),
[Download API](https://playwright.dev/docs/api/class-download), and
[evaluation guide](https://playwright.dev/docs/evaluating) were re-read.
They confirm temporary-download deletion on context close, a start event
distinct from completion, failure/cancellation reporting, and separation of
page JavaScript from the controlling process. Those facts motivate observation;
they do not prove a KOTA defect. The peer runtime was not installed or trialed.

Validation: `pnpm test:owner src/modules/web-access/web-fetch.test.ts
src/modules/web-access/http-request.test.ts
src/modules/browser/browser-observation-tools.test.ts` passed **102 tests in
3 files**. HTTP cases use the real transport with substituted DNS/dispatcher
ports and disposable files: byte equality for representative UTF-8/binary
responses, oversized-save rejection without replacement, scope escapes,
body-read failures and timeouts. Browser cases substitute the page/lifecycle
and establish serialization/truncation and close delegation only. These are
owner checks, not a live export, a cancellation journey, or assistant behavior.

The actual `pnpm kota eval contained '{"operation":"inspect"}'` request reached
the host owner and returned exit 1 with `is_error: true`: configure
`KOTA_EVAL_CONTAINED_PROFILES` in the trusted host environment; worker requests
cannot configure host access. Tool use: `tool-03ab8752580759e7635f7a606dd5edbd`.
Locally, Playwright 1.60.0 imports on Node 22.19.0 / Darwin arm64, but its
resolved Chromium executable is not visible in this sandbox. This is not a
claim about host-wide browser or credential availability. No host profile
search, browser install, daemon control, model call, or export trial ran.
The inspection response and proof provenance are retained in
`browser-export-investigation.json` under the artifacts of builder run
`2026-09-21T10-36-14-050Z-builder-p3gbo9`.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An authorized disposable KOTA browser/model export observation, or equivalent attributable session/tool and delivered-file evidence.

The path is a discovery hint, not a required capture location. An applicable
host grant through `src/modules/eval-harness/contained-evaluation.md`, or an
already authorized KOTA session elsewhere, must provide the actual browser
and assistant environment. Worker code must not acquire host authority or
copy login material. Public HTTP downloads must keep their existing network
policy; any private browser fixture needs its explicit authorized origin.
No personal browser profile or third-party service credentials are necessary
for invented reports.

Resume with the existing tools first: an ordinary HTTP(S) report and a
browser-generated Blob or session-bound report, including data exceeding
20,000 characters and an export failure/cancellation. Retain the actual
request, tool arguments/results, assistant completion claim, source/model/tool
and environment identities, expected bytes and delivered file. Independently
compare bytes at the authorized destination after browser close, check that
failure is not reported as completion, and keep suggested names separate from
authorized paths. If extraction needs multiple calls, verify complete lengths
and bytes; do not reconstruct from a truncated result. Scripted transport
feasibility and model-selected behavior must be reported separately. Only an
observed failing boundary should justify a deduplicated browser-owned follow-up.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-21T10:45:36.886Z -->
