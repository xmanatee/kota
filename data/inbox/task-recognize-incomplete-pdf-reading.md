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

Before promotion, check maintained product evidence and trace how the supported
session consumes this result. If unresolved, compare a small, invented report
with mixed text/scanned pages against text-only and blank-page controls. Retain
rendered pages, actual tool output and the user's resulting answer or recovery
message; distinguish extraction coverage from model reasoning. Determine whether
the existing tools suffice, a coverage signal would help, or optional OCR is
worth its setup and execution costs. No new store, benchmark suite or mandatory
parser dependency is proposed.

The current explorer environment has no pdftotext/pdftoppm on PATH, and its
python3 cannot discover pdfminer, PyPDF2 or pypdf. No document conversion or
live answer comparison ran. This observation does not establish capabilities
of other KOTA deployments.

Overlap checked: archived read-document migration/split tasks preserved behavior;
the archived source-grounded research synthesis fixture explicitly excludes
PDF/OCR quality. The active workbook task owns editing and preservation, not
PDF reading. No matching active task or external-pattern decision was found.
