---
status: done
---

# Move Vercel AI stream support into the Vercel adapter module

## Problem

`src/vercel-ai-stream.ts` is integration-specific support for the Vercel AI SDK
Data Stream Protocol. The `vercel-adapter` module owns the route and public
integration, but the stream helper remains in root `src/`.

## Desired Outcome

Co-locate the Vercel stream implementation and tests with
`src/modules/vercel-adapter/`.

## Constraints

- Do not add a root compatibility export.
- Keep the public HTTP behavior unchanged.
- Keep the task scoped to Vercel adapter ownership.
- Update tests/imports directly.

## Done When

- Vercel stream code and tests live under `src/modules/vercel-adapter/`.
- No production import references `#root/vercel-ai-stream.js`.
- The adapter module remains the obvious owner of Vercel AI SDK protocol support.
