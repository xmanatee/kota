# Stores

KOTA's persistent and session-scoped data lives in typed stores. These form one
runtime state subsystem. When you need to persist something, pick the store
whose scope and lifetime match — do not invent a new persistence surface.

## Store Types

### History

**Scope**: Global. **Lifetime**: Permanent, pruned by count.

Immutable conversation records. Each record holds the message log, model,
working directory, and compaction state. Use `getHistory()` (or the active
`HistoryProvider`) to recall past sessions.

- Pruned to 20 user conversations and 100 action conversations automatically.
- Stored under `~/.kota/history/`.

### Memory

**Scope**: Global. **Lifetime**: Permanent, pruned at 100 entries.

Short facts and notes the agent wants to recall across sessions. Use
`getMemoryStore()` (or the active `MemoryProvider`) to save and search entries.
An alternative SQLite backend (`SQLiteMemoryProvider`) is available for
unbounded storage.

- Stored in `~/.kota/memory.json` by default.

### Knowledge

**Scope**: Project or global. **Lifetime**: Permanent (explicit delete).

Structured reference entries with tags, status, and full-text search. Use
`getKnowledgeStore(cwd)` (or the active `KnowledgeProvider`) for material
that agents and users should be able to find and update over time.

- Project entries: `.kota/data/`. Global entries: `~/.kota/data/`.
- Each entry is a markdown file with YAML front matter.

### Working Memory

**Scope**: Session. **Lifetime**: Session (optional persist via module storage).

In-memory key-value scratchpad rendered into the agent's system prompt under
`<working-memory>`. Use `setEntry`/`getEntry` to hold current context during a
session. Cleared when the session closes unless the entry is marked persistent.

- Limit: 20 entries, 500 chars each, 4000 chars total.
- Persistent entries survive restart via per-module storage.

### Run Artifacts

**Scope**: Project. **Lifetime**: Permanent (manual cleanup).

Workflow execution records: run metadata, step outputs, agent logs, error
reports, and cost tracking. Managed by `WorkflowRunStore`. Stored under
`.kota/runs/<run-id>/`.

Agents read run artifacts via step output forwarding or direct file reads.
This is the right store for durable evidence of what automated workflows did.

## Scope Summary

| Store | Scope | Access |
|-------|-------|--------|
| History | Global | `getHistory()` / `HistoryProvider` |
| Memory | Global | `getMemoryStore()` / `MemoryProvider` |
| Knowledge | Project + Global | `getKnowledgeStore(cwd)` / `KnowledgeProvider` |
| Working Memory | Session | `setEntry` / `getEntry` (from `src/memory/working-memory.ts`) |
| Run Artifacts | Project | `WorkflowRunStore`, direct file reads under `.kota/runs/` |

## Durable State for Autonomous Workflows

The autonomous workflows operate on repo-local durable state:

- **Inbox + task files** (`data/inbox/`, `data/tasks/`) — capture surface, work queue, and status.
- **Git history** — implementation record.
- **Run artifacts** (`.kota/runs/`) — execution evidence, step outputs, costs.

These are project-scoped and version-controlled or audit-logged by the workflow
engine. Use them for autonomous agent state that needs to survive across runs.

Use the global stores (memory, knowledge, history) for agent notes and user
data that should persist across projects or be accessible in interactive
sessions.

## Provider Registry

The core stores (memory, knowledge, history, task) can be swapped for
alternative backends using the provider registry in `src/providers.ts`.
Modules register custom backends via `registerProvider(type, provider)`.

## Module Storage

Modules get isolated file-based storage through `ModuleContext.storage`
(under `.kota/modules/<name>/`). This is for private module data, not shared
agent state. Prefer the shared stores above when data should be visible across
modules or sessions.
