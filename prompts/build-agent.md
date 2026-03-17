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
- **Verification**: Run `npm run typecheck && npm run build` before finishing.
- **CHANGELOG**: Update with heading `## Iteration {{ITERATION}} — Short Title`
  followed by a one-line summary (becomes git commit subject — under 120 chars,
  no markdown formatting), then detailed sections: what, why, verification,
  future directions.

## How to Work

### 1. Orient

Read BUILDER_LESSONS.md, NOTES.md (`b:` = for you), DESIGN.md (architecture),
git log, and recent CHANGELOG. Run `npm test 2>&1 | tail -20` — fix inherited
failures before new work. Run `python3 parse-log.py --trend 5` — note the work
pattern and use it during brainstorming.

Do NOT read source files yet — DESIGN.md and CHANGELOG are sufficient for
deciding what to build.

### 2. Decide what to build

**Brainstorm 3-5 candidates** from your orientation inputs. Think broadly: new
capabilities, architecture improvements, composition of existing features,
owner suggestions, research-inspired ideas.

**Choose the highest-impact option.** Evaluate each on: what does this make
possible that wasn't possible before? Features unlock new workflows ("user asks
to analyze a webpage → agent extracts content → summarizes"). Architecture work
unlocks new properties ("any developer can create a working module using
ModuleContext alone" or "modules can be swapped without touching other code").
Both are concrete capability gains.

Watch for diminishing returns: with 26+ tools, each new tool must clear a
higher bar. Ask: can existing tools approximate this? If yes, the delta is
small. Architecture and composition work that makes the EXISTING 26 tools
more reliable, independent, or composable often delivers more per iteration.

Be skeptical — assess on your own merits, don't defer to any single source.
Record rejected candidates in CHANGELOG under "Future directions."

### 3. Research targeted unknowns

For your top candidates, search the web to answer specific implementation
questions — APIs, patterns, pitfalls. Working implementations beat docs. Skip
for narrow bug fixes.

### 4. Implement

NOW read source files — only those relevant to your chosen work. Every file
read adds context and degrades downstream reasoning. Use grep to find files.

Write real, working code. Auto-fix lint per file (`npx biome check --write
<file>`). For cross-cutting changes: grep all consumers first, fix consumers
before changing the shared type, run `npm run typecheck` immediately after. See
BUILDER_LESSONS.md for details.

Keep `DESIGN.md` accurate. Update NOTES.md for related `b:` items.

### 5. Verify (all five levels)

- **Static**: `npm run typecheck && npm run build`
- **Unit**: Test incrementally — `npx vitest run src/foo.test.ts` as you write,
  `npx vitest run --changed` for broader checks, `npm test` once at end. Write
  tests for new modules. Vitest, `*.test.ts` next to source.
- **Lint**: `npx biome check` on changed files only (pre-existing issues exist).
- **Load**: `node dist/cli.js --help`
- **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
  (report SKIP if no `ANTHROPIC_API_KEY`)

### 6. Record

Update `CHANGELOG.md` with what you built, why, verification results, and
future directions.

## Tech

TypeScript/Node.js with the Anthropic Claude API. Keep dependencies minimal.
Prefer files under ~300 lines; split when they become hard to reason about.
