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
  no markdown formatting). Keep entries under 25 lines total: what changed (3-5
  lines), candidates considered (1-line each), verification (1 line), future
  directions (2-3 bullets). Session logs capture full detail.

## How to Work

### 1. Orient

Read BUILDER_LESSONS.md, NOTES.md (`b:` = for you), git log, `tail -80
CHANGELOG.md`. Scan DESIGN.md headers (`grep '^##' DESIGN.md`).
Do NOT read source files or full DESIGN.md — headers and CHANGELOG suffice.

Run `npm test 2>&1 | tail -20` (fix inherited failures), then
`python3 parse-log.py --trend 5` (note the work pattern for brainstorming).

### 2. Decide what to build

**Brainstorm 3-5 candidates** from your orientation inputs. Think broadly: new
capabilities, architecture improvements, composition of existing features,
owner suggestions, research-inspired ideas. Draw from different parts of the
codebase — don't anchor on what was recently built.

**Choose the highest-impact option.** Evaluate each on: what does this make
possible that wasn't possible before? Features unlock new workflows ("user asks
to analyze a webpage → agent extracts content → summarizes"). Architecture work
unlocks new properties ("any developer can create a working module using
ModuleContext alone" or "modules can be swapped without touching other code").
Both are concrete capability gains.

Watch for diminishing returns. Classify each recent feature iteration by
top-level system from the trend (e.g., "modules" includes manifest steps,
scripts, logging, factory, providers; "tools" includes new CLI tools). At 3+
consecutive same-system iterations, that system is deeply saturated — even
novel-sounding work there adds less than opening a new capability front. Ask:
can existing capabilities approximate this? If yes, the delta is small.

**Examples of strong choices** from this project's history:
- Iter 523: After 5 tool iterations, chose observation masking — opened a
  different capability class (context management), informed by NeurIPS research.
- Iter 565: Computer use + screenshot = full GUI paradigm. One feature that
  opened an entirely new interaction mode.
- Iter 569: ctx.callTool made all 26+ tools composable from module code — one
  architecture choice amplifying everything already built.

For promising candidates, search the web for prior art, APIs, and pitfalls —
existing implementations often reveal better approaches or hidden complexity
that changes the ranking. Working code beats documentation.

Be skeptical — assess on your own merits, don't defer to any single source.
Record rejected candidates in CHANGELOG under "Future directions."

### 3. Implement

NOW read source files — only those relevant to your chosen work. Every file
read adds context and degrades downstream reasoning. Use grep to find files.

Write real, working code. Auto-fix lint per file (`npx biome check --write
<file>`). For cross-cutting changes: grep all consumers first, fix consumers
before changing the shared type, run `npm run typecheck` immediately after. See
BUILDER_LESSONS.md for details.

Keep `DESIGN.md` accurate — but concise. When updating, condense verbose
sections for stable components (1-2 lines + code snippet if needed). DESIGN.md
must stay under ~1100 lines / 25000 tokens to remain fully readable.
Update NOTES.md for related `b:` items.

### 4. Verify (all five levels)

- **Static**: `npm run typecheck && npm run build`
- **Unit**: Test incrementally — `npx vitest run src/foo.test.ts` as you write,
  `npx vitest run --changed` for broader checks, `npm test` once at end. Write
  tests for new modules. Vitest, `*.test.ts` next to source.
- **Lint**: `npx biome check` on changed files only (pre-existing issues exist).
- **Load**: `node dist/cli.js --help`
- **Runtime**: `echo "Say hello" | node dist/cli.js run --model claude-haiku-4-5-20251001`
  (report SKIP if no `ANTHROPIC_API_KEY`)

### 5. Record

Update `CHANGELOG.md` — keep entries concise (under 25 lines).

## Tech

TypeScript/Node.js with the Anthropic Claude API. Keep dependencies minimal.
Prefer files under ~300 lines; split when they become hard to reason about.
