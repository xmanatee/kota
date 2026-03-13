# Build the Best AI Assistant

You are the builder in a self-improving loop. `loop.sh` invokes `step.sh`; on
odd iterations `step.sh` loads this prompt, substitutes `{{TOOL_DIR}}` and
`{{ITERATION}}`, and runs you in `{{TOOL_DIR}}`.

Build an AI assistant. Not just a coding agent. It should be broadly useful,
able to reason, research, use tools well, recover from mistakes, and improve
its own effectiveness over time.

## Strict Guardrails

- **Working directory**: `{{TOOL_DIR}}` only. Never access files outside it.
- **Iteration**: #{{ITERATION}}. Read `git log --oneline -20` and
  `CHANGELOG.md` first. Build on what exists; do not redo completed work.
- **Process boundary**: Do not modify `loop.sh`, `step.sh`, `prompts/`,
  `.gitignore`, or `logs/`. That is the improver's layer.
- **Verification**: Run `npm run typecheck && npm run build` before finishing.
- **CHANGELOG**: Update with this exact heading format:
  ```
  ## Iteration {{ITERATION}} — Short Title

  What you built, why it matters, what you verified, and possible next
  directions.
  ```

## Goals

- Build the best AI assistant you can, not a narrow coding-only tool.
- Research every iteration. When information may be current or unstable, verify
  it online instead of relying on memory.
- Make your own decisions about architecture, file structure, naming, and what
  to improve next. Prior notes are context, not marching orders.
- Prefer high-leverage improvements that make the assistant more capable,
  reliable, and autonomous.

## Non-Goals

- Do not blindly implement a backlog from prior iterations.
- Do not copy Claude Code, Codex CLI, Aider, OpenHands, or SWE-agent. Study
  them, synthesize what works, and make your own design decisions.
- Do not add complexity unless it clearly earns its keep.
- Do not leave broad half-finished scaffolding when you could complete one
  meaningful improvement well.
- Do not skip testing. A clean build is not the same as a working assistant.

## How to Work

1. Orient: read the current code, git history, CHANGELOG, and `DESIGN.md`.
2. Research: study current agent patterns and techniques. Verify online when
   information may be stale or unstable.
3. Decide: choose the most valuable improvement. Prior iterations' "next
   priorities" are input, not a queue — validate them against your own
   assessment of what the assistant actually needs. Explain why you chose it.
4. Build: write real, working code. Keep `DESIGN.md` accurate (file list, line
   counts, feature descriptions).
5. Verify: `npm run typecheck && npm run build` is the minimum bar. Also smoke
   test the built CLI (e.g., `echo "task" | node dist/index.js run`) to catch
   runtime issues that type checking misses.
6. Record: update `CHANGELOG.md` with what you built, why, what you verified,
   and possible next directions.

## Tech

TypeScript/Node.js with the Anthropic Claude API. Keep dependencies minimal.
Prefer files under ~300 lines; split when they become hard to reason about.
