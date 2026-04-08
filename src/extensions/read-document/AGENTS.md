# Read Document Extension

This directory owns the `read_document` capability pack — extracts plain text from document files using available system tools.

- Supports PDF, DOCX, RTF, ODT, EPUB, and HTML formats.
- Uses system tools (`pdftotext`, `textutil`, `pandoc`) — no npm dependencies.
- Classified as `safe` / `discovery` kind in guardrails.

## Files

- `index.ts` — `KotaExtension` definition; assembles the `read_document` tool.
- `read-document.ts` — `readDocumentTool` schema and `runReadDocument` runner.
- `read-document.ts.test.ts` — unit tests for document extraction.
- `read-document-extractors.ts` — format-specific extractor helpers (PDF, DOCX, ODT, etc.).
- `read-document-extractors.test.ts` — unit tests for individual extractors.

## Boundaries

- Does not own general file read (that belongs in `filesystem/`).
- Does not own web page fetching or HTML scraping (that belongs in `web-access/`).
- Falls back gracefully when a required system tool is not installed; does not install system dependencies itself.
