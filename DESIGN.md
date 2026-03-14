# KOTA — Keep Only The Awesome

A general-purpose AI agent that synthesizes the best ideas from Claude Code, Codex CLI, Aider, SWE-agent, and OpenHands into a simple, powerful architecture.

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
- **Structured compaction** (`src/compaction.ts`): Two-phase approach preserves more context than naive summarization:
  1. **Deterministic state extraction**: Scans old messages for file modifications, shell commands run, and errors — produces exact facts no LLM summary could reliably preserve
  2. **Rich LLM narrative**: Builds detailed conversation representation (extracts text, tool call signatures, and result previews from structured blocks instead of showing "(structured content)"), then asks the LLM to summarize goals, decisions, progress, and gotchas
  3. **Combined output**: The compacted context includes both the structured working state block and the narrative summary, so the agent knows exactly which files it modified and what commands it ran, plus the reasoning context
- **Event-sourced**: Each turn is an immutable event; compaction creates a new "snapshot" event

### Token Budget Awareness

The agent tracks context window usage and adapts its behavior as budget fills:

- **Budget display**: Each turn shows `context: N%` on stderr so the user sees usage
- **Dynamic system prompt**: When >50% used, a budget note is injected via a separate (uncached) system block: `[Context budget: 62% used (124K/200K tokens) — be concise]`
- **Adaptive tool result truncation**: Tool results are automatically truncated based on remaining budget:
  - <50%: 50K char limit (generous)
  - 50–75%: 15K char limit
  - >75%: 5K char limit (aggressive — finish up)
- **Truncation preserves head + tail**: Keeps 60% from the start and 30% from the end, with a notice explaining the omission
- **Split system blocks**: Static prompt (cached with `cache_control: ephemeral`) and dynamic state (uncached, changes per turn) are sent as separate system blocks, so prompt caching remains effective even when budget notes change

### Streaming (`src/streaming.ts`)

Extracted streaming and retry logic used by the main agent loop:

- **Retry with backoff**: Mid-stream failures retry up to 3 times with jittered exponential backoff
- **Error classification**: Auth/config errors fail fast; transient errors (network, rate limit, overload) retry
- **Thinking support**: Extended thinking events stream to stderr
- **Text streaming**: Response text streams to stdout token-by-token

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
| `repo_map` | Structural codebase index | Regex-extracted exports, grouped by file |
| `delegate` | Sub-agent exploration | Read-only mini-loop, returns summary |
| `multi_edit` | Atomic multi-file edits | All succeed or all revert |
| `web_fetch` | Fetch web pages | HTML stripping, truncation, timeout |
| `memory` | Persistent cross-session memory | Save/search/list/delete facts, preferences, conventions |
| `web_search` | Web search via DuckDuckGo | No API key needed, returns titles/URLs/snippets |
| `ask_user` | Ask user a question | Interactive via /dev/tty, graceful non-TTY fallback |

### Web Search (`src/tools/web-search.ts`)

Enables the agent to search the web autonomously using DuckDuckGo — no API key required.

- Scrapes `html.duckduckgo.com/html/` with result parsing via regex
- Extracts title, URL (with DuckDuckGo redirect decoding), and snippet per result
- Two-tier parser: structured block parsing with fallback to global regex extraction
- Returns compact numbered results (default 5, max 10) to save tokens
- 15-second timeout, proper User-Agent, clean error messages
- Pairs with `web_fetch`: search discovers URLs, fetch reads full pages

### Ask User (`src/tools/ask-user.ts`)

Interactive collaboration tool — the agent can ask questions mid-task.

- Opens `/dev/tty` directly to read from the terminal (works even when stdin is piped)
- Visual separator and bold prompt on stderr for clear user attention
- Graceful degradation: when no TTY is available (CI, containers), returns a message telling the agent to proceed with its best judgment
- Override hook (`setPromptOverride`) for testing without a terminal
- System prompt guides usage: ask only when the agent genuinely cannot proceed without user input

### Session Warmup (`src/init.ts`)

Automatic context gathering at session start — KOTA knows where it is before the first turn.

- **Project detection**: Reads `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `requirements.txt`, or `Makefile` — extracts project name, key frameworks, test runner, available scripts
- **Git state**: Branch name, working tree status (N modified, N untracked), last 5 commit subjects — via synchronous `execSync` (fast, ~10ms)
- **Memory recall**: Searches persistent memory for entries matching the current directory name, shows top 5 matches
- All detection is synchronous, zero-dependency, and gracefully degrades (no git → skip, no config file → skip, no memories → skip)
- Context injected into the static system prompt at session start; persists across turns via prompt caching

### Persistent Memory (`src/memory.ts`, `src/tools/memory.ts`)

Cross-session memory that persists facts, preferences, and project knowledge in `~/.kota/memory.json`.

- **Save**: Store content with optional tags for categorization
- **Search**: Keyword matching across content and tags, ranked by relevance (multi-term scoring)
- **List/Delete**: Full CRUD for memory management
- Auto-prune at 100 memories (oldest removed)
- Lazy-loaded from disk on first access, persisted after each write
- System prompt hints the agent to check memory at session start and save important context

### Repo Map (`src/tools/repo-map.ts`)

Inspired by Aider's repo map but drastically simplified — regex extraction instead of tree-sitter AST parsing.

- Scans `.ts`, `.tsx`, `.js`, `.jsx`, `.py` files via glob (skips `node_modules`, `dist`, `.git`, `.d.ts`)
- Extracts exported symbols via regex: functions, classes, constants, interfaces, types, enums
- Python: extracts top-level `def` and `class` definitions
- Output grouped by file path, one line per symbol with compact signatures
- Capped at 100 files / 200 symbols to prevent context bloat

### Sub-Agent Delegation (`src/tools/delegate.ts`)

Inspired by Claude Code's Agent tool — spawns a separate LLM call for tasks that should run outside the main context.

**Two modes:**

- **`explore`** (default): Read-only research and exploration. Tools: `file_read`, `grep`, `glob`, `repo_map`, `web_search`, `web_fetch`. Max 10 turns.
- **`execute`**: Can modify files and run commands. All explore tools plus `file_edit`, `file_write`, `multi_edit`, `shell` (60s timeout cap). Max 15 turns. Reports which files were modified.

**Design decisions:**
- Creates a fresh Anthropic API call per delegation — main context only sees the task and final answer
- Sub-agent uses Sonnet for cost efficiency
- Execute mode shell commands are capped at 60s timeout to prevent runaways
- Execute mode tracks modified files from `file_edit`, `file_write`, and `multi_edit` inputs, and appends them to the result so the main agent knows what changed
- The main agent is guided (via system prompt) to assign non-overlapping file responsibilities to avoid conflicts between parallel delegations
- Each mode has a dedicated system prompt: explore focuses on thorough research; execute focuses on precise implementation and verification

### Architect/Editor Split (`src/architect.ts`)

From Aider's research: separating "what to do" from "how to edit" improves results by 3-8%.

**Two-pass flow** (enabled via `--architect` / `-a` flag):

1. **Architect pass**: LLM called WITHOUT tools. System prompt instructs it to analyze the task and produce a step-by-step implementation plan in natural language. Reasoning streams to stderr so the user can follow the thinking process.
2. **Editor pass**: LLM called in a FRESH conversation with only `file_read`, `file_write`, `file_edit` tools. The architect's plan is the sole user message. The editor executes the plan literally, running its own mini-loop (up to 30 turns) until all changes are made.
3. **Verification**: After the editor completes, the main loop continues with all tools available for builds, tests, and type checks.

**Key design decisions:**
- Self-pairing (same model for both passes) gives +3% improvement over single-pass
- Editor gets a fresh context — no shared history from the architect phase
- Architect output goes to stderr, editor output goes to stdout
- The existing single-pass loop remains the default (no `--architect` = standard mode)

### Project Context (`src/project-context.ts`)

Makes KOTA project-aware by reading `.kota.md` files from the working directory up to the filesystem root (like Claude Code's `CLAUDE.md`).

- Walks up directory tree collecting `.kota.md` files (max 10 levels)
- Returns root-first ordering: general context first, specific project context last
- Content injected into the system prompt on session start
- Per-file truncation at 8000 chars to prevent context bloat
- Verbose mode logs when project context is loaded

### Smart Edit Error Recovery (`src/tools/file-edit.ts`)

Two-tier recovery when `file_edit`'s `old_string` is not found:

**Tier 1 — Whitespace-tolerant auto-fix**: Before reporting an error, the tool tries
whitespace-normalized matching. If the non-whitespace content matches exactly (same
tokens, different indentation/trailing spaces), the edit is applied automatically:

- Normalizes both search and file content: trims each line, collapses blank lines
- Requires at least 10 non-whitespace characters (prevents trivially short matches like `}`)
- Must be unambiguous: exactly one region in the file matches after normalization
- Tries variable window sizes to handle blank-line differences between search and file
- Reports "Applied with whitespace correction" so the agent knows what happened
- Still runs lint gate — reverts if the corrected edit breaks syntax

**Tier 2 — Fuzzy match display**: When whitespace-tolerant matching also fails, finds
the closest-matching region using bigram similarity:

- **Bigram similarity** (Dice coefficient): fast, zero-dependency fuzzy matching
- **Sliding window**: scores every region of the file that matches the search's line count
- **Context display**: shows the best match with 5 lines of surrounding context, line numbers, and `>>>` markers on the matched lines
- **Similarity threshold**: shows the match at >40% similarity; below that, shows first 30 lines with a suggestion to re-read the file
- Dramatically reduces wasted turns — the agent can see exactly what the actual content looks like near where it expected to edit

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

### Prompt Caching

System prompt is sent as a `TextBlockParam[]` with `cache_control: { type: "ephemeral" }`. This enables Anthropic's automatic prompt caching:

- The static prefix (tools + system prompt) is cached across turns at 0.1x cost
- Only new content (latest messages) pays full input token price
- Cache stats (`cache_read_input_tokens`, `cache_creation_input_tokens`) logged in verbose mode
- No beta headers needed — prompt caching is GA

### Streaming Output

Real-time text streaming via `client.messages.stream()`. Text appears token-by-token as the model generates it, instead of waiting for the full response. Tool calls are still collected and executed after the stream completes.

### Extended Thinking (`--think`)

Leverages Claude's extended thinking API for deeper reasoning before acting.

- **`--think` / `-t`**: Enables extended thinking on the main loop and architect pass
- **`--think-budget <tokens>`**: Configurable budget (default 10000, min 1024)
- `max_tokens` automatically increases to `budget_tokens + max_tokens` to leave room for output
- Thinking content streams to stderr: full text in verbose mode, "[kota] Thinking..." indicator otherwise
- Thinking blocks are preserved in conversation history for multi-turn consistency
- Not enabled for editor pass (mechanical execution) or delegate sub-agents (quick exploration)

### Web Fetch (`src/tools/web-fetch.ts`)

Enables the agent to access web pages for research, documentation lookup, and verification.

- Built-in Node.js `fetch` API — zero additional dependencies
- HTML tag stripping: removes `<script>`, `<style>`, converts block elements to newlines, decodes HTML entities
- Response truncation to configurable `max_length` (default 20000 chars) for token efficiency
- 30-second timeout, redirect following, clean error messages

### Diff Display (`src/diff.ts`)

Every file modification (edit, write, multi-edit) prints a compact diff to stderr so the user can see what changed without reading tool results.

- **`file_edit`**: colored unified diff with 2 lines of context around the change
- **`file_write` (overwrite)**: one-line summary showing old → new line count
- **`multi_edit`**: per-edit diffs for each file modified
- Large diffs (>40 lines) show a one-line summary instead of flooding the terminal
- Colors (red/green) when stderr is a TTY, plain text otherwise

### Streaming Shell Output (`src/tools/shell.ts`)

Shell commands stream output to stderr in real-time via async `spawn`, instead of blocking silently with `execSync`.

- User sees build/test progress as it happens, not after completion
- Command echoed before execution: `$ command` (dimmed)
- Both stdout and stderr stream to the user's terminal and are collected for the tool result
- Timeout via `SIGTERM` with `SIGKILL` fallback after 5s
- Successful output truncated at 20K chars (first 10K + last 5K)
- Failed commands use smart error extraction (see Shell Error Diagnostics below)
- Failed commands get automatic source context enrichment (see Error Context Enrichment below)

### Shell Error Diagnostics (`src/shell-diagnostics.ts`)

When shell commands fail with long output, naive head+tail truncation often loses the critical error messages buried in the middle. This module detects common output formats and extracts the most diagnostic-relevant lines.

- **Threshold**: Only activates for outputs >8K chars; short outputs returned as-is
- **TypeScript compiler**: Extracts `error TSxxxx` lines from both `file(line,col)` and `file:line:col` formats, deduplicates
- **Test runners**: Detects vitest/jest/mocha patterns — `FAIL` markers, `×`/`✗`/`●` bullets, assertion errors, `Expected`/`Received` blocks. Captures failure regions with context and summary lines
- **Lint tools**: Extracts ESLint `file:line:col: error` format and Biome `×` markers. Prioritizes errors over warnings
- **Generic**: Matches `Error:`, `FAILED`, `fatal:`, `panic:`, `command not found`, `Permission denied` with 1 line before + 3 after for context
- **Fallback**: If no extractor matches, falls back to head+tail truncation
- **Output format**: Extracted diagnostics prepended with count, followed by the output tail (last 20 lines) for summary context

### Error Context Enrichment (`src/error-context.ts`)

When a shell command fails with errors that reference specific files and line numbers, the agent normally has to spend a turn reading those files before it can fix the issue. This module automatically pre-fetches the surrounding source code and appends it to the error output, saving that turn.

- **Pattern detection**: Extracts file:line references from TypeScript compiler errors (`file(line,col)` and `file:line:col` formats), ESLint/Biome output, Node.js stack traces, and Python tracebacks
- **Source context**: Reads ±5 lines around each referenced line, with a `>` marker on the target line
- **Project-scoped**: Only reads files that exist on disk; skips `node_modules`, `dist`, `.git`, `coverage`, `__pycache__`, and URLs
- **Deduplication**: Merges nearby references to the same file (within 10 lines) into one context block
- **Bounded**: Max 5 file references per error to prevent context bloat
- **Integration**: Runs after `smartErrorTruncate` in the shell tool, so the agent sees both extracted diagnostics and the relevant source code in one tool result
- **Transparent**: Appended as a clearly labeled `--- Referenced source ---` section

### Tool Runner (`src/tool-runner.ts`)

Extracted tool execution and failure tracking, keeping `loop.ts` focused on orchestration:

- **Parallel execution**: Tool calls execute via `Promise.all` with verbose logging
- **Result truncation**: Budget-aware truncation applied before returning to the agent loop
- **Auto-retry**: Transient failures are retried once via the retry module (see below) before being reported to the agent
- **Progressive failure tracking** (`FailureTracker` class): Two levels of stuck-loop detection:
  - **Identical failures** (same error signature): hard circuit break after 3 — the agent is repeating the exact same broken operation
  - **Diverse failures** (different errors): soft guidance after 5 consecutive failures — the agent is trying variations that all fail, injected message tells it to step back and reconsider

### Automatic Tool Retry (`src/tool-retry.ts`)

When a tool call fails with a transient error, the tool runner automatically retries once with adjusted parameters — saving the agent a wasted turn.

- **Shell timeouts**: Retries with 2× the timeout (up to 300s max). Catches builds/tests that are slow but not stuck.
- **Web fetch transient errors**: Retries after 1.5s delay for ECONNRESET, ETIMEDOUT, ECONNREFUSED, socket hang up, HTTP 429/500/502/503/504.
- **Web search transient errors**: Same pattern as web fetch.
- **Bounded**: Maximum 1 retry per tool call. No retry for permanent errors (404, file not found, syntax errors, etc.).
- **Transparent**: On success, appends "(Succeeded on auto-retry: reason)". On double failure, appends both error messages so the agent has full context.
- **Scoped to main loop**: Retry only applies in the tool runner (main agent loop), not in delegate sub-agents where bounded execution is preferred.

### Selective Message Pruning (`src/message-pruning.ts`)

A pre-compaction step that extends the useful context window by trimming large read-only tool results from older messages. Runs before full compaction and at a lower threshold (50% vs 75%), reducing token usage without losing conversation structure.

- **Read-only tools only**: Prunes results from `file_read`, `grep`, `glob`, `repo_map`, `web_fetch`, `web_search`, `delegate` — tools whose results are reproducible by re-running
- **Never prunes**: Error results, write/edit results, shell output, or any result still within the recent message window
- **Summary replacement**: Each pruned result is replaced with a compact summary that tells the agent what was there (e.g., `[Previously read: src/foo.ts — 150 lines. Re-read if needed.]`), so it knows it can re-run the tool if needed
- **Threshold**: Activates when context budget exceeds 50%, only prunes messages older than the most recent 20
- **Size filter**: Only prunes results larger than 1500 characters (small results aren't worth the disruption)
- **Idempotent**: Pruned summaries are short enough that subsequent calls skip them
- **Deterministic**: No LLM call needed — pure pattern matching and string replacement
- **Two-phase context lifecycle**: Pruning runs first (50%), then full compaction (75%) if still needed. This gives the agent more usable turns before the more lossy LLM-based compaction kicks in

### Smart File Path Resolution (`src/path-resolver.ts`)

When `file_read` or `file_edit` receives a path that doesn't exist, instead of returning a bare "file not found" error, KOTA searches the project for alternatives:

- **Exact basename match**: Globs for `**/<filename>` — catches the common case where the agent has the right filename but wrong directory
- **Fuzzy basename match**: If no exact match, searches files with the same extension and ranks by bigram (Dice coefficient) similarity — catches typos and name variations
- **Bounded search**: Ignores `node_modules`, `dist`, `.git`, etc.; caps depth and results to stay fast
- **Zero cost on hit**: The glob search only runs when the file doesn't exist — no overhead for valid paths
- Both `file_read` and `file_edit` use the shared `fileNotFoundError()` formatter, producing error messages like:
  ```
  Error: file not found: src/utils/helper.ts

  Similar files found:
    - src/lib/helper.ts
    - tests/helper.ts
  ```

### File Freshness Tracking (`src/file-tracker.ts`)

Detects when files change between a `file_read` and a subsequent `file_edit`, preventing a common class of stale-content failures:

- **mtime-based**: Uses `statSync().mtimeMs` to track when files were last read or modified by the agent
- **Stale detection**: Before `file_edit` applies a change, checks if the file's mtime differs from the last known value (catches shell commands, external tools, or other processes that modified the file)
- **Warning injection**: On stale detection, prepends a warning to the tool result suggesting the agent re-read the file
- **Self-updating**: Records new mtime after every read, edit, or write — avoids false positives from the agent's own modifications

### Verification Nudge System (`src/verify-tracker.ts`)

Addresses the #1 agent failure mode: making file changes without verifying they work. The system detects unverified edits and nudges the agent to run tests/builds.

- **Project-aware command detection**: Reads `package.json` scripts, `Makefile` targets, `Cargo.toml`, and `pyproject.toml` to discover available verification commands (`test`, `typecheck`, `lint`, `build`)
- **Package manager detection**: Automatically uses `pnpm`, `yarn`, or `npm` based on which lock file exists
- **Edit tracking**: Records every successful `file_edit`, `file_write`, and `multi_edit` operation
- **Verification detection**: Recognizes shell commands that are verification (test, lint, build, typecheck, tsc, vitest, jest, pytest, cargo check, go test, etc.) and clears the unverified list
- **Dynamic system prompt injection**: Unverified files and available commands are shown in the dynamic (uncached) system prompt block, so the agent sees them every turn
- **Escalating urgency**: After 3 turns of edits without verification, a stronger nudge appears: "Consider verifying before making more changes"
- **Zero overhead when clean**: When no files are pending verification, the tracker adds nothing to the system prompt

## File Structure

```
src/
  cli.ts              — Entry point, Commander.js (~115 lines)
  loop.ts             — AgentSession class + core agent loop (~270 lines)
  system-prompt.ts    — System prompt constant (~46 lines)
  tool-runner.ts      — Parallel tool execution + failure tracking (~115 lines)
  tool-retry.ts       — Automatic retry for transient tool failures (~90 lines)
  message-pruning.ts  — Selective pruning of old tool results (~145 lines)
  streaming.ts        — Stream with retry + error classification (~85 lines)
  architect.ts        — Architect/Editor two-pass flow (~135 lines)
  compaction.ts       — Structured context compaction (~170 lines)
  context.ts          — Conversation + budget tracking + pruning (~190 lines)
  confirm.ts          — Destructive command confirmation (~50 lines)
  cost.ts             — Per-turn cost tracking (~65 lines)
  diff.ts             — Diff display for file edits (~90 lines)
  file-tracker.ts     — mtime-based file freshness detection (~55 lines)
  init.ts             — Session warmup: project/git/memory detection (~150 lines)
  lint.ts             — Syntax checking for linter-gated edits (~100 lines)
  memory.ts           — Persistent memory store (~110 lines)
  path-resolver.ts    — Smart file path suggestions on not-found (~100 lines)
  project-context.ts  — .kota.md file discovery and loading (~65 lines)
  shell-diagnostics.ts — Smart error extraction from shell output (~165 lines)
  error-context.ts    — Source context enrichment for shell errors (~140 lines)
  verify-tracker.ts   — Verification nudge system (~155 lines)
  mcp-client.ts       — Lightweight MCP JSON-RPC stdio client (~170 lines)
  mcp-manager.ts      — Multi-server MCP lifecycle + tool routing (~135 lines)
  mcp-client.test.ts  — MCP client unit tests (~35 lines)
  mcp-manager.test.ts — MCP manager + namespacing unit tests (~80 lines)
  message-pruning.test.ts — Message pruning unit tests (~265 lines)
  error-context.test.ts — Error context enrichment unit tests (~225 lines)
  shell-diagnostics.test.ts — Error extraction unit tests (~175 lines)
  path-resolver.test.ts — Path resolution + similarity unit tests (~80 lines)
  tool-runner.test.ts — FailureTracker unit tests (~95 lines)
  tool-retry.test.ts  — Retry policy + maybeRetry unit tests (~135 lines)
  compaction.test.ts  — extractWorkingState unit tests (~130 lines)
  cost.test.ts        — CostTracker unit tests (~120 lines)
  memory.test.ts      — MemoryStore unit tests (~100 lines)
  verify-tracker.test.ts — VerifyTracker + command detection unit tests (~205 lines)
  tools/
    index.ts      — Tool registry + executor (~70 lines)
    shell.ts      — Async shell with streaming output + error enrichment (~135 lines)
    file-read.ts  — Read file with line numbers + freshness tracking + path suggestions (~70 lines)
    file-write.ts — Create/overwrite file with lint gate + diff (~70 lines)
    file-edit.ts  — Search-and-replace with whitespace-tolerant auto-fix + fuzzy recovery (~275 lines)
    multi-edit.ts — Atomic multi-file edits + diff (~120 lines)
    grep.ts       — Content search via ripgrep, context lines (~90 lines)
    glob.ts       — File pattern matching (~60 lines)
    todo.ts       — Task tracking (~95 lines)
    repo-map.ts   — Structural codebase index (~125 lines)
    delegate.ts   — Sub-agent delegation: explore + execute modes (~240 lines)
    delegate.test.ts — Delegate file tracking unit tests (~65 lines)
    memory.ts     — Persistent cross-session memory tool (~90 lines)
    web-fetch.ts  — Web page fetching with HTML stripping (~125 lines)
    web-search.ts — Web search via DuckDuckGo scraping (~200 lines)
    ask-user.ts   — Interactive user questions via /dev/tty (~95 lines)
    file-edit.test.ts — Whitespace-tolerant matching unit tests (~135 lines)
    ask-user.test.ts — Ask user tool unit tests (~60 lines)
```

Total: ~6970 lines across 54 files (including 15 test files with ~2050 lines).

## What Makes KOTA Better

1. **Simplicity**: ~5400 lines total vs thousands in competitors. Easy to understand, modify, extend.
2. **Best-of-breed tools**: 14 tools designed using Anthropic's tool design principles (meaningful errors, token-efficient output, defensive defaults).
3. **Project-aware**: Reads `.kota.md` files from the working directory up the tree (like Claude Code's CLAUDE.md). Project conventions, architecture notes, and preferences are injected into the system prompt automatically.
4. **Smart error recovery**: Two-tier edit recovery. First, whitespace-tolerant auto-fix: if the content matches after normalizing indentation/trailing spaces, the edit is applied automatically (saving 1-2 turns). If that fails, fuzzy matching (bigram Dice coefficient) finds the closest region and shows it with line numbers and context.
5. **Persistent sessions**: `AgentSession` class maintains full conversation context across multiple prompts — interactive REPL is a true multi-turn conversation, not isolated one-shots.
6. **Stream resilience**: Mid-stream API failures are retried with exponential backoff and jitter. Permanent errors (auth, bad request) fail fast; transient errors (network, overload) retry up to 3 times. SDK-level retries increased from default 2 to 5.
7. **Extended thinking**: Optional deep reasoning via `--think` flag — the model thinks through complex problems before acting, improving plan quality and reducing wasted tool calls.
8. **Web search + fetch**: `web_search` discovers URLs via DuckDuckGo (no API key), `web_fetch` reads full pages. The agent can autonomously research errors, find documentation, and verify current information.
9. **Linter-gated edits**: Every file write/edit is syntax-checked. Broken edits are auto-reverted with clear error messages, preventing cascading failures (from SWE-agent).
10. **Streaming output**: Text appears in real-time as the model generates it, not after the full response completes. Shell commands also stream their output to stderr, so users see build/test progress live.
11. **Diff display**: Every file edit/write prints a colored unified diff to stderr — the user sees exactly what changed without reading tool results.
12. **Architect/Editor split**: Optional two-pass flow separates reasoning from editing. Same technique that gives Aider +3-8% on benchmarks.
13. **Prompt caching**: System prompt sent with `cache_control: { type: "ephemeral" }` — cached prefix reads at 0.1x cost, making multi-turn conversations dramatically cheaper.
14. **Cost tracking**: Real-time per-turn cost display with cache-aware pricing for Sonnet/Opus/Haiku.
15. **Repo map**: Structural index of the codebase via regex extraction — lets the agent orient itself without reading every file.
16. **Sub-agent delegation**: Two-mode delegation — `explore` for read-only research and `execute` for write-capable subtasks. Execute mode gives sub-agents file modification and shell access, tracks which files they change, and reports back. The main agent can dispatch implementation work to sub-agents while keeping its own context clean.
17. **Session persistence**: Save/resume conversation state across interruptions via `--session`.
18. **Safety**: Destructive command confirmation, progressive failure tracking (identical + diverse failures), tool confirmation via `--yes`.
19. **Persistent memory**: Cross-session memory stores facts, preferences, and project conventions in `~/.kota/memory.json`. The agent can save and recall context across sessions, transforming from a stateless tool into a personal assistant that learns.
20. **Token budget awareness**: The agent tracks context window usage and adapts — large tool results are automatically truncated as budget fills, the agent sees budget warnings in the system prompt above 50%, and the user sees `context: N%` on every turn. Split system blocks keep prompt caching effective despite dynamic budget notes.
21. **Session warmup**: At session start, KOTA auto-detects the project type (Node.js, Python, Rust, Go), reads git state (branch, dirty files, recent commits), and recalls relevant memories from previous sessions. The agent starts oriented from turn 1 instead of spending turns on discovery.
22. **Progressive failure detection**: Two-level stuck-loop detection — 3 identical failures trigger a hard stop; 5 diverse consecutive failures inject guidance to step back and reconsider. Catches the common "agent tries variations that all fail" pattern that simple circuit breakers miss.
23. **File freshness tracking**: mtime-based detection of files modified between reads and edits. When a shell command or external process changes a file after the agent read it, the agent is warned before attempting an edit — preventing stale-content failures.
24. **Structured compaction**: When context is compacted, deterministic extraction preserves which files were modified, which commands were run, and what errors occurred — facts that naive LLM summarization reliably loses. The richer representation also feeds more useful context to the LLM summarizer, producing better narrative summaries of goals, decisions, and progress.
25. **Unit test suite**: 196 tests across 12 modules (FailureTracker, extractWorkingState, CostTracker, MemoryStore, path-resolver, ask-user, verify-tracker, shell-diagnostics, file-edit, tool-retry, message-pruning, error-context) using vitest. Tests cover state machine transitions, message parsing edge cases, pricing arithmetic, search scoring, persistence, file path similarity, interactive tool behavior, verification nudge logic, error extraction patterns, whitespace-tolerant matching, retry policy logic, message pruning, and error context enrichment.
26. **Smart file path resolution**: When `file_read` or `file_edit` gets a file-not-found error, the agent automatically sees suggestions — files with the same basename (exact match) or similar names (fuzzy match via bigram similarity). Saves the agent from wasting a turn on `glob` to find the right path.
27. **Interactive user collaboration**: The `ask_user` tool lets the agent ask questions mid-task — for clarification, decisions, or information only the user can provide. Uses `/dev/tty` to work even when stdin is piped. Graceful degradation in non-interactive environments.
28. **Context-aware grep**: The `grep` tool supports `context_lines` to show surrounding lines around matches, saving a follow-up `file_read` round trip.
29. **Research-capable delegation**: Sub-agents have `web_search` and `web_fetch` in addition to code exploration tools, so delegated research can discover and read online documentation. Execute mode sub-agents additionally have `file_edit`, `file_write`, `multi_edit`, and `shell` (60s timeout), enabling the main agent to orchestrate parallel implementation work.
30. **Verification nudge system**: Tracks which files have been edited but not verified via tests/builds. Detects available verification commands from project config (package.json, Makefile, Cargo.toml, pyproject.toml) and surfaces them in the dynamic system prompt. Escalating urgency: after 3 turns of edits without verification, a stronger nudge appears. Resets when the agent runs a verification command.
31. **Shell error diagnostics**: When shell commands fail with long output (>8K chars), smart extraction finds the diagnostic-relevant lines instead of naive head+tail truncation. Detects TypeScript compiler errors, test runner failures (vitest/jest), lint errors (ESLint/Biome), and generic error patterns. The agent sees extracted errors + output tail, not a random slice of verbose logs.
32. **Automatic tool retry**: Transient tool failures (shell timeouts, web network errors, HTTP 429/5xx) are automatically retried once with adjusted parameters — shell gets 2× the timeout, web tools get a 1.5s delay. Saves 1-2 turns per transient failure without agent involvement. Bounded to 1 retry, scoped to the main loop only.
33. **Selective message pruning**: Two-phase context lifecycle extends the agent's effective working memory. At 50% context usage, large read-only tool results (file_read, grep, glob, web_fetch, etc.) from older messages are replaced with compact summaries — preserving conversation structure while recovering tokens. Full LLM-based compaction only triggers at 75%, giving the agent more useful turns before losing detailed context. Deterministic, no LLM call needed, idempotent.
34. **Error context enrichment**: When shell commands fail with errors that reference specific file paths and line numbers (TypeScript errors, test failures, lint errors, stack traces), the surrounding source code is automatically pre-fetched and appended. Supports TypeScript, ESLint/Biome, Node.js stack traces, and Python tracebacks. Bounded to 5 references with ±5 lines each. Saves the agent 1 turn per error cycle — it can diagnose and fix without a separate `file_read`.
35. **MCP (Model Context Protocol) client**: Connect external tool servers via the industry-standard MCP protocol. Configure servers in `.kota/mcp.json` (same format as Claude Desktop/Claude Code). Each server's tools are namespaced as `mcp__<server>__<tool>` and routed automatically. Supports stdio transport, graceful degradation on server failure, and async initialization. Transforms KOTA from a closed system into an extensible platform — users can add database access, API integrations, and custom tools without modifying source.

## Dependencies

- `@anthropic-ai/sdk` — Claude API client
- `commander` — CLI argument parsing
- `glob` — File pattern matching
- `vitest` — Unit testing framework
- TypeScript + tsx for dev, tsup for build
