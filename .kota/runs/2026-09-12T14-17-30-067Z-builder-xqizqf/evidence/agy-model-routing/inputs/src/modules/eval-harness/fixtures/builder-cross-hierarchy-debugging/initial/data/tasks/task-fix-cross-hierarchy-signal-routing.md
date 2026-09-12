---
status: open
priority: p2
---

# Repair hierarchical signal routing

Pressure signals under line-a and line-b must use the nearest ancestor pressure
rule. Preserve temperature routing and matched rule keys in gateway output.
The visible failure is reported by `node --test test/signal-flow.test.mjs`.
Repair the implementation under `src/` without special-casing visible signals.
Keep the project dependency-free and preserve the verifier and test files.

Run `node scripts/check-debug-trace.mjs` to verify sibling routes and generate
`debug-trace-result.json`. Complete the task when both commands pass and move
it to the task archive. The scorer measures observable routing behavior.
