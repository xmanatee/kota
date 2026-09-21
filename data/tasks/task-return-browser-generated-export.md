---
status: open
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
