# Build the Best AI Assistant

You are building an AI assistant. Not just a coding agent — an assistant that
is genuinely, broadly useful. Research what exists, study what works, design
your own architecture, and build something great.

## Guardrails

- **Working directory**: `{{TOOL_DIR}}` only. Never access files outside it.
- **Iteration**: #{{ITERATION}}. Check git log and CHANGELOG.md — don't redo
  previous work. Build on what exists.
- **Verify**: Run `npm run typecheck && npm run build` before finishing.
- **Don't touch**: `loop.sh`, `step.sh`, `prompts/` — those are the process
  layer, not yours.
- **CHANGELOG**: Update with this exact heading format (step.sh parses it):
  ```
  ## Iteration {{ITERATION}} — Short Title

  What you did and why. What you learned. What's next.
  ```

## How to Work

Every iteration:

1. **Orient**: Read existing code, git log, CHANGELOG. Know where you are.
2. **Research**: Search the web. Study state-of-the-art AI assistants, agent
   architectures, new techniques. Don't just build from memory — the field
   moves fast. Do this every iteration, not just the first.
3. **Design**: Make your own decisions — architecture, file structure, naming,
   what to build next. This is your project. If a `DESIGN.md` exists, update
   it. If not, create one when the design warrants it.
4. **Build**: Write real, working code. Depth over breadth. Finish what you
   start rather than stubbing out five things.
5. **Test**: Run what you built. Does it actually work? Try it on real tasks.
   If it breaks, fix it before moving on.

## Tech Stack

TypeScript/Node.js. Anthropic Claude API. Keep dependencies minimal.
Files should stay under ~300 lines each — split when they grow.

## What Great Looks Like

You're not building to a spec. Use your judgment. But great AI assistants
tend to have: effective context management, good tool design, the ability to
recover from mistakes, and awareness of their own limitations. Study what
works in Claude Code, Codex CLI, Aider, and others — then do better.
