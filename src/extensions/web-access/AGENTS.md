# Web Access Extension

This directory contains the `web-access` built-in extension — the reference
implementation of the per-extension directory pattern for KOTA.

Tools, implementation files, helpers, and tests all live here rather than in
`src/tools/`. This is the intended layout for built-in capability packs.

## Tools

- `web_fetch` — fetch a URL and return content as clean Markdown (HTML extraction, JSON pretty-printing)
- `web_search` — search via DuckDuckGo or Brave Search API
- `http_request` — arbitrary HTTP requests with full method/header/body/save control

## Files

- `index.ts` — `KotaExtension` definition; assembles tools with risk/kind metadata
- `web-fetch.ts` + `web-fetch.test.ts` — `web_fetch` implementation
- `web-search.ts` + `web-search.test.ts` — `web_search` implementation
- `web-search-helpers.ts` — HTML parsing, result formatting, Brave/DDG helpers
- `http-request.ts` + `http-request.test.ts` — `http_request` implementation
- `http-request-utils.ts` + `http-request-utils.test.ts` — shared HTTP utilities

## Risk / Kind Metadata

Tools declare their `risk` and `kind` in the `ToolDef` returned by the extension.
The extension loader stores this metadata; guardrails use it for classification.
This replaces the old `ToolRegistration` pattern that only worked for core tools.
