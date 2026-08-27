---
status: done
---

# Split tools/knowledge.ts — extract tool schema into knowledge-schema.ts

## Problem

`tools/knowledge.ts` is 279 lines and nearing the 300-line file size limit. The `knowledgeTool` Anthropic tool schema (a static object, ~68 lines) is a separate concern from the formatter helpers and the `runKnowledge` async runner that implements the actual logic.

## Desired Outcome

Extract the tool schema declaration into `tools/knowledge-schema.ts`:
- `knowledgeTool` (the `Anthropic.Tool` export)

`knowledge.ts` retains `formatEntry`, `formatEntryFull`, and `runKnowledge`, importing `knowledgeTool` from the new file and re-exporting it for existing callers.

## Constraints

- No behavior changes — structural split only.
- All existing imports of `knowledgeTool` and `runKnowledge` from `knowledge.ts` must continue to work.
- The new file exports only the schema; no runner or formatter logic leaks into it.

## Done When

- `knowledge-schema.ts` exists and exports `knowledgeTool`.
- `knowledge.ts` is measurably shorter (under 220 lines).
- `npm run typecheck`, `npm run test`, and `npm run lint` all pass.
