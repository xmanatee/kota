# KOTA — Keep Only The Awesome

A coding agent that synthesizes the best ideas from Claude Code, Codex CLI, Aider, SWE-agent, and OpenHands into a simple, powerful architecture.

## Research Summary

| Agent | Key Insight Borrowed |
|-------|---------------------|
| Claude Code | Sub-agent delegation, TodoWrite task tracking, context compaction |
| Codex CLI | Two-tool MVP (shell + apply_patch), prompt caching via static prefix |
| Aider | Architect/Editor split — separate reasoning from edit generation |
| SWE-agent | Linter-gated edits — reject changes that break syntax |
| OpenHands | Event-sourced conversation state (clean replay/compaction) |
| Anthropic "Building Effective Agents" | Start simple, add complexity only when needed; 5 workflow patterns |
| Anthropic "Writing Tools for Agents" | Tools as API contracts for non-deterministic clients |

## Architecture

### Core Loop (`src/loop.ts`)

```
User prompt
    │
    ▼
┌─────────────────────────────────┐
│  Send messages[] to LLM API    │
│  (system prompt + conversation) │
└─────────┬───────────────────────┘
          │
          ▼
    ┌───────────┐     ┌──────────────┐
    │ Text reply│────▶│ Return to    │
    │ (no tools)│     │ user / done  │
    └───────────┘     └──────────────┘
          │
    ┌───────────┐
    │ Tool calls│
    └─────┬─────┘
          │
          ▼
    ┌─────────────────┐
    │ Execute tools    │
    │ (parallel OK)    │
    └─────┬───────────┘
          │
          ▼
    ┌─────────────────┐
    │ Append results   │
    │ to messages[]    │
    └─────┬───────────┘
          │
          ▼
    (loop back to LLM)
```

This is the same loop used by Claude Code and Codex CLI. The key insight from Anthropic's research: **the simplest agent is just an LLM in a while loop with tools**.

### Context Management (`src/context.ts`)

Inspired by Claude Code's compaction strategy:

- **Static prefix**: System prompt + tool definitions (cacheable, never changes)
- **Dynamic suffix**: Conversation turns (grows with each interaction)
- **Compaction trigger**: When token count exceeds 75% of context window
- **Compaction method**: Summarize older turns into a single "context so far" message, keep recent turns intact
- **Event-sourced**: Each turn is an immutable event; compaction creates a new "snapshot" event

### Tool System (`src/tools/`)

Inspired by Anthropic's "Writing Tools for Agents" and Codex CLI's minimalism:

**Design principles:**
1. Tools are API contracts — clear names, typed parameters, meaningful errors
2. Output is token-efficient — no verbose dumps, paginated where needed
3. Errors guide the agent — "File not found at X. Did you mean Y?" not "ENOENT"
4. Two tools get you 80% there: `shell` + `file_edit`

**Tool set (priority order):**

| Tool | Purpose | Notes |
|------|---------|-------|
| `shell` | Run any shell command | Timeout, cwd support. The Swiss Army knife. |
| `file_read` | Read file contents | Line numbers, offset/limit for large files |
| `file_write` | Create/overwrite a file | For new files only |
| `file_edit` | Search-and-replace edit | Exact string match, like Claude Code's Edit tool |
| `grep` | Search file contents | Regex support, ripgrep-style |
| `glob` | Find files by pattern | Fast file discovery |
| `todo` | Track task progress | Injected into system prompt, TodoWrite-style |

### Architect/Editor Split (Future — P1)

From Aider's research: separating "what to do" from "how to edit" improves results by 3-8%.

- **Phase 1 (this iteration)**: Single-model loop with all tools
- **Phase 2**: Architect call (reasoning model, no tools) → Editor call (fast model, edit tools only)

### Linter-Gated Edits (`src/lint.ts`)

From SWE-agent: after each `file_edit` or `file_write`, run a syntax check. If it fails, auto-revert and tell the agent what went wrong. This prevents cascading errors from bad edits.

**Supported file types:**
| Extension | Checker | Notes |
|-----------|---------|-------|
| `.json` | `JSON.parse()` | Built-in, always available |
| `.js`, `.cjs`, `.mjs` | `node --check` | Built-in, always available |
| `.ts`, `.tsx`, `.jsx`, `.mts`, `.cts` | esbuild `transformSync` | Gracefully skips if esbuild not installed |
| `.py` | `ast.parse()` via python3 | Gracefully skips if python3 not available |

**Behavior:**
- On lint failure: file is reverted to its previous state (or deleted if newly created)
- Error message includes the syntax error details to guide the agent's retry
- Unknown file types pass without checking (no false negatives)

### Streaming Output

Real-time text streaming via `client.messages.stream()`. Text appears token-by-token as the model generates it, instead of waiting for the full response. Tool calls are still collected and executed after the stream completes.

### Circuit Breaker

Stop after 3 identical consecutive tool failures. Prevents infinite loops where the agent keeps trying the same broken approach.

## File Structure

```
src/
  cli.ts          — Entry point, Commander.js (~100 lines)
  loop.ts         — Core agent loop with streaming (~140 lines)
  context.ts      — Conversation + compaction (~130 lines)
  lint.ts         — Syntax checking for linter-gated edits (~95 lines)
  tools/
    index.ts      — Tool registry + executor (~50 lines)
    shell.ts      — Shell command execution (~70 lines)
    file-read.ts  — Read file with line numbers (~65 lines)
    file-write.ts — Create/overwrite file with lint gate (~60 lines)
    file-edit.ts  — Search-and-replace edit with lint gate (~100 lines)
    grep.ts       — Content search via ripgrep (~85 lines)
    glob.ts       — File pattern matching (~60 lines)
    todo.ts       — Task tracking (~95 lines)
```

Total: ~1050 lines across 12 files. Each file ≤ 150 lines.

## What Makes KOTA Better

1. **Simplicity**: ~1050 lines total vs thousands in competitors. Easy to understand, modify, extend.
2. **Best-of-breed tools**: Each tool designed using Anthropic's tool design principles (meaningful errors, token-efficient output, defensive defaults).
3. **Linter-gated edits**: Every file write/edit is syntax-checked. Broken edits are auto-reverted with clear error messages, preventing cascading failures (from SWE-agent).
4. **Streaming output**: Text appears in real-time as the model generates it, not after the full response completes.
5. **Prompt caching**: Static system prompt enables efficient caching — cost scales linearly not quadratically.
6. **Task tracking**: TodoWrite-style tracking injected as system context so the agent always knows what's done and what's left.
7. **Extensible architecture**: Adding a new tool = one file + one registry entry. No framework, no abstractions.

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `commander` — CLI argument parsing
- `glob` — File pattern matching
- TypeScript + tsx for dev, tsup for build
