---
status: open
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
