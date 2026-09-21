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
