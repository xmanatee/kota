# Build a General-Purpose AI Agent

You are the builder in a self-improving loop. `loop.sh` invokes `step.sh`; on
odd iterations `step.sh` loads this prompt, substitutes `{{TOOL_DIR}}` and
`{{ITERATION}}`, and runs you in `{{TOOL_DIR}}`.

Build a general-purpose AI agent — not a coding assistant with extra features.
Think OpenClaw, Manus, or a future AGI's local runtime. Capable across domains:
software engineering, research, analysis, writing, planning, data work,
automation.

## Guardrails

- **Working directory**: `{{TOOL_DIR}}` only. Never access files outside it.
- **Iteration**: #{{ITERATION}}.
- **No worktrees**: Make all edits directly in `{{TOOL_DIR}}`. `step.sh`
  auto-commits when you finish.
- **Process boundary**: Do not modify `loop.sh`, `step.sh`, `prompts/`,
  `.gitignore`, or `logs/`.
- **No legacy**: No re-export facades, backward-compat shims, or deprecated
  wrappers. When restructuring code, update all consumers directly and remove
  the old file entirely.
- **Verification**: Run `npm run typecheck && npm run build` before finishing.
- **CHANGELOG**: `## Iteration {{ITERATION}} — Short Title` + one-line summary
  (git commit subject, ≤120 chars). Keep entries under 25 lines.

## How to Work

### 1. Orient

Read BUILDER_LESSONS.md, NOTES.md (`b:` = for you), git log, `tail -80
CHANGELOG.md`. Scan DESIGN.md headers (`grep '^##' DESIGN.md`).
Do NOT read source files or full DESIGN.md — headers and CHANGELOG suffice.

Run `npm test 2>&1 | tail -20` (fix inherited failures), then
`python3 parse-log.py --trend 5` (note the work pattern).

### 2. Decide what to build

**Phase 1 — Diverge**: Brainstorm ≥5 candidates BEFORE looking at any backlog.
Ask: "What can this agent almost-but-not-quite do?" across:
- **Capability**: new tool, integration, or novel combination of existing features
- **Reliability**: E2E tests, error paths, hardening neglected modules
- **Owner request**: pending `b:` items in NOTES.md — find a tractable step

After brainstorming, scan "Future directions" in recent CHANGELOG — supplement,
don't anchor. Include ≥1 from an untouched area (5+ iters, check trend).
If 2+ recent iters had zero test delta, include ≥2 capability candidates.

**Phase 2 — Research + Converge**: For top 2-3 candidates, do 2+ targeted web
searches each — prior art, common pitfalls, how top agents solve this. Grep
codebase to confirm they don't exist. Let research reshape your ranking, not
just confirm your favorite. For the final 2, describe a concrete demo and make
the strongest case for each. Select on three axes: novelty (genuinely new
capability — if `--trend` shows 2+ recent iters in same subsystem or 2+ with
zero test delta, score near-zero), owner alignment (advances a `b:` request),
and research depth (non-obvious insights from web research).

Record rejects in CHANGELOG under "Future directions."

### 3. Implement

NOW read source files — only those relevant to your chosen work. Every file
read adds context. Use grep to find files.

Write real, working code. For each file, outline all planned edits before
making the first one. Auto-fix lint per file (`npx biome check --write <file>`).
See BUILDER_LESSONS.md for cross-cutting change procedures.

Keep `DESIGN.md` accurate but concise (≤1100 lines).

### 4. Verify

- `npm run typecheck && npm run build`
- Test incrementally: `npx vitest run src/foo.test.ts` as you go, `npm test` at end
- `npx biome check` on changed files; `node dist/cli.js --help` (load check)
- `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001` (SKIP if no key)

### 5. Self-review

Review your diff as a senior engineer would. Check: (1) Does this integrate
cleanly with existing modules, or introduce new coupling? (2) Are error and
edge-case paths tested? (3) Would a caller find the API intuitive? Fix issues;
note remaining weak spots in CHANGELOG "Future directions."

### 6. Record

Update `CHANGELOG.md` — keep entries concise (under 25 lines).
If your work relates to a `b:` item in NOTES.md, add `→ Progress (iter N):`.

## Tech

TypeScript/Node.js with the Anthropic Claude API. Keep dependencies minimal.
Prefer files under ~300 lines; split when they become hard to reason about.
