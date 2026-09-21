---
status: blocked
priority: p3
---
# Can KOTA recognize an incompletely read PDF?

Explorer discovery, September 21, 2026; an unresolved research question, not
an observed user failure or an instruction to adopt a document framework.

Consider a report with a selectable-text introduction and a scanned appendix
containing the decisive fact. Can KOTA answer from the appendix, or explain
which pages it could not read instead of treating the introduction as enough?
Compare a genuinely blank page so that absence of extracted text alone does
not become a false claim of missing content.

Primary sources read online today:

- [pypdf extraction guidance](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)
  distinguishes embedded text, scanned images and OCR text layers. It cannot
  itself recognize image text and explains why applying OCR to every digitally
  generated page can discard useful information.
- [Docling conversion confidence](https://docling-project.github.io/docling/concepts/confidence_scores/)
  exposes page and document assessments for conversion triage. Its table score
  is explicitly unimplemented; these scores are not proof of answer correctness.
- [Docling's OCR example](https://docling-project.github.io/docling/_generated/examples/full_page_ocr/)
  offers full-page processing through selectable OCR backends, with additional
  dependencies and potentially greater latency than hybrid processing.
- [Deployment options](https://docling-project.github.io/docling/usage/advanced_options/)
  distinguish local processing, prefetched model assets and explicit remote
  service opt-in. Local execution still requires provisioning models.

Local relevance: `src/modules/read-document/read-document-extractors.ts`
tries pdftotext, pdfminer and PyPDF2, returning aggregate text and method.
`read-document.ts` reports character truncation and warns about image-based
content only when the aggregate text is empty. The inspected owner tests mock
the extractor process; they do not establish the mixed-page product outcome.
This is a source-level reason to investigate, not a measured omission.

Check maintained product evidence and trace how the supported
session consumes this result. If unresolved, compare a small, invented report
with mixed text/scanned pages against text-only and blank-page controls. Retain
rendered pages, actual tool output and the user's resulting answer or recovery
message; distinguish extraction coverage from model reasoning. Determine whether
the existing tools suffice, a coverage signal would help, or optional OCR is
worth its setup and execution costs. No new store, benchmark suite or mandatory
parser dependency is proposed.

The discovery run reported no pdftotext/pdftoppm on PATH, and its
python3 cannot discover pdfminer, PyPDF2 or pypdf. No document conversion or
live answer comparison ran. This observation does not establish capabilities
of other KOTA deployments.

Overlap checked: archived read-document migration/split tasks preserved behavior;
the archived source-grounded research synthesis fixture explicitly excludes
PDF/OCR quality. The active workbook task owns editing and preservation, not
PDF reading. No matching active task or external-pattern decision was found.

## Research Outcome And Acceptance

Determine whether a supported KOTA session can use the decisive scanned appendix
or honestly explain its reading limitation. No urgency was stated; p3 reflects
an exploratory question, not a confirmed defect or a parser-adoption mandate.

- Inspect maintained evidence and the supported session's admitted tools,
  document-result consumption and available recovery capabilities. Establish
  whether existing evidence already answers the question before collecting more.
- If unresolved, use the small invented mixed-page report above alongside
  text-only and genuinely blank-page controls through an authorized KOTA path.
  Retain the input documents, rendered pages, request, actual tool output,
  resulting answer or recovery message, and model/tool/environment attribution.
  Distinguish extraction coverage, requested page ranges, character truncation,
  and model reasoning; a nonempty extract is not proof of complete reading,
  and a textless page is not by itself proof of unread content.
- Record a grounded disposition: existing behavior suffices, no demonstrated
  gap, or a concrete deduplicated follow-up for the responsible owner. Compare
  coverage signaling or optional OCR only if evidence warrants it, including
  setup and execution costs. No new store, benchmark suite or mandatory parser
  dependency is prescribed.
- Advance source investigation and available scoped validation independently
  of live execution. If necessary observation ultimately needs an unavailable
  external capability, retain completed findings and identify that specific
  prerequisite under the task contract; do not infer it from another task.

## Triage Provenance — September 21, 2026

Normalized from `data/inbox/task-recognize-incomplete-pdf-reading.md`. All four
linked sources were readable during triage and support the distinctions above;
neither external implementation was executed. The discovery environment report
was not re-probed and does not establish this run's or other deployments' setup.

The active queue contains no matching PDF-reading investigation. The workbook
task concerns editing and preservation. The archived source-grounded synthesis
fixture explicitly excludes PDF/OCR quality. The inspected read-document owner
tests control subprocess output and cover page selection, fallback, truncation
and empty extraction; they do not demonstrate the mixed-page session outcome.

`src/modules/read-document/index.ts` registers `runReadDocument` as the tool
runner. Its extractor returns aggregate text and method; the tool's image-based
warning is conditional on empty aggregate text. The shared conversational loop
in `src/core/loop/loop-send.ts` executes selected tools, adds their results to
context, and continues model generation. This identifies a consumption seam,
not proof of behavior across harnesses or of which tools a deployment admits.
The preliminary inspection did not settle the product question; deeper coverage
and session-capability investigation remains useful, so the task stays open.
No PDF conversion, live session comparison or behavioral test ran in triage.

## Builder Findings — September 21, 2026

Run `2026-09-21T07-46-30-439Z-builder-3br1j7` inspected source revision
`c65c95f4818b883a8b24728fe9dbe46f31a4b7fb`. Both `read_document` and the
filesystem PDF reader expose aggregate text without page-coverage assessment;
the conversational loop adds their results to model context. The filesystem
image reader can carry rendered pages, but session admission, rendering/OCR
availability and model image support still require live attribution. Maintained
owner tests and the archived synthesis task do not establish the mixed-page
outcome. No model failure or parser-adoption need is demonstrated.

Prepared four invented PDFs and seven rendered pages: mixed text/scanned report,
visually equivalent text-only report, introduction plus genuinely blank page,
and standalone blank page. The provisional count is 24; the final count of 73
appears only in the nonblank appendix. Auxiliary system PDFKit extraction reads
the text-only appendix and returns empty text for both the scan and blank page;
it is input validation, not production KOTA extraction. Renders were inspected.

Twenty-one direct production tool-runner calls inside this builder sandbox
returned 19 explicit missing-extractor PDF errors and two successful image-block
results. Full-document, page-specific and character-limited requests were made,
but parser unavailability prevented measuring coverage or truncation. Neither
pdftotext/pdftoppm nor the Python fallback modules are available in this sandbox;
two bounded isolated PyPDF2 setup attempts returned no matching distribution.
These observations do not describe other deployments. The existing owner suites
passed (2 files, 41 tests); their controlled subprocesses are not live model proof.

Inputs, renders, prepared request, complete actual tool responses, environment
and source attribution, setup logs and findings are retained under this run's
`artifacts/pdf-reading/`, alongside the runtime-owned `agent/` directory.
`findings.md` identifies the consumption and recovery owners and remaining proof.
No production code, dependency, store or evaluation suite changed. No new task is
justified before this task's remaining comparison; OCR benefit/cost is unmeasured.

## Blocked on

kind: operator-capture
path: .kota/runs/
description: An authorized supported KOTA session comparison of the retained PDF controls with a working extractor and attributable tools, model, results and answer or recovery, or an equivalent scoped capture/export.

The path is an evidence-discovery hint, not a required capture location.

An authorized supported KOTA session comparison of the retained controls, with a
working PDF extractor and attributable admitted tools, model/harness, actual
results and final answer or recovery. The current run invoked
`pnpm kota eval contained '{"operation":"inspect"}'`; the trusted host returned
an explicit error requiring `KOTA_EVAL_CONTAINED_PROFILES`. The exact response is
retained in `artifacts/pdf-reading/host-inspection.txt`. This establishes missing
evaluation grants, not missing host credentials or general host capability.

Resume when the host supplies an appropriate contained model profile/scenario
or equivalent authorized scoped session capture/export for these inputs. The
worker cannot configure host grants. No particular artifact path or manual
operator execution is required. Retain initial and recovered answers separately,
keep observer ground truth out of fresh model sessions, and distinguish scan
coverage from blank pages, explicit page ranges and character truncation. The
live comparison and resulting grounded disposition remain unmet; source and
local validation work above is complete and safe independently of this blocker.
