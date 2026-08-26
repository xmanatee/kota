# Web Access Module

This directory contains the `web-access` repo module — the reference
implementation of the per-module directory pattern for KOTA.

Tools, implementation files, helpers, and tests all live here rather than in
`src/core/tools/`. This is the intended layout for scope capability packs.

## Tools

- `web_fetch` — fetch a URL and return content as clean Markdown (HTML extraction, JSON pretty-printing)
- `web_search` — search via DuckDuckGo or Brave Search API
- `http_request` — arbitrary HTTP requests with full method/header/body/save control

## Risk / Kind Metadata

Tools declare their effect metadata in the `ToolDef` returned by the module.
The module loader stores this metadata; guardrails use it for classification.
`web_fetch` and `http_request` also treat `save_to` as a scope-local
filesystem write, and the runners reject save paths outside the scope root.
Web-access runners select the shared outbound HTTP transport's
`public-untrusted` profile, which rejects loopback/private-network targets and
pins DNS again at connection time. Configured search providers select their
configured-provider origin explicitly. Keep response rendering and save-path
behavior here; transport policy belongs in `src/core/outbound-http/`.
