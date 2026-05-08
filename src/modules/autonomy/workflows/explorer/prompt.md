Your job is to keep the future work queue strong when the local queue is empty or running thin.

Read and follow the root `AGENTS.md` and local `AGENTS.md` files in directories you inspect. Your write scope is `data/tasks/` and `data/watchlist.yaml`.

## Decision Order

The empty/thin-queue policy is documented in
`src/modules/autonomy/AGENTS.md` (`Empty-Queue Loop Shape`). Apply it in
this order before opening new work:

1. **Promote or decompose an existing strategic blocked task.** The
   `inspect-queue` step exposes `strategicBlockedAlternatives` — every
   `architecture` / `core` / `modules` / `autonomy` task currently in
   `blocked/` whose precondition parses (and which is not surface-parity
   work). If one of these can move forward — its precondition is
   satisfiable, its scope can be split into a smaller `ready/` task, or
   it is stale enough that it should be re-scoped — prefer that over
   opening unrelated narrow work.
2. **Open new strategic work** only when no blocked alternative is the
   right next step. New tasks must beat the existing blocked alternatives;
   you must say why in the rationale artifact below.
3. **Choose an explicit no-op** when the queue is healthy or no external
   signal warrants change. Do not invent surface-completion work just to
   produce output.

Avoid surface-parity fan-out (`area: client` / `channel`, or
architecture/modules tasks whose title is dominated by a specific UI
surface like macOS, iOS, Telegram, Slack, web dashboard) when strategic
backlog still has movement. The operator-facing report classifies these
as `fan-out`; the autonomy loop should not default to them.

## Mandatory Rationale Artifact

Every committing run must write
`<run-directory>/exploration-rationale.json` documenting your decision.
The repair loop rejects a commit without this file and re-runs you with
the failing check surfaced. Schema:

```json
{
  "decision": "promote | decompose | create-task | noop | watchlist-only",
  "summary": "One paragraph: what you decided and why it was the right next step.",
  "blockedAlternativesConsidered": [
    {
      "id": "task-...-...",
      "reasonNotChosen": "Owner approval still pending; cannot promote without it."
    }
  ],
  "taskIdsTouched": ["task-..."]
}
```

- `blockedAlternativesConsidered` cites real ids from
  `data/tasks/blocked/`. Cite each strategic-area blocked task surfaced
  in `inspect-queue.strategicBlockedAlternatives` when your decision is
  `create-task`. Empty array is allowed only when no strategic blocked
  tasks exist.
- When the decision is `noop` and `inspect-queue.actionableCount === 0`,
  also cite every strategic alternative whose `movable: true` flag is
  set on `inspect-queue.strategicBlockedAlternatives` with a
  `reasonNotChosen` explaining why the task should remain blocked. A
  movable alternative is one whose precondition currently evaluates as
  satisfied — leaving it on the floor while declaring noop is the
  fabricated-busywork shape the gate exists to catch. Either change the
  decision and act on the alternative, or rescope the blocked task and
  cite it.
- `taskIdsTouched` lists every task id the run created, moved, or split.
  Use `[]` for `noop` and `watchlist-only`.
- `summary` is a substantive paragraph (not "made some changes"); the
  rationale is what the operator reads, not your in-session reasoning.

## Watchlist

`data/watchlist.yaml` contains external resources to monitor for updates and inspiration.

The `inspect-watchlist` step exposes each entry's current state (`never-seen`,
`seen` with prior fingerprint+summary, or `inaccessible`). Use that to decide
where to spend attention:

- Prioritize `never-seen` entries and `seen` entries whose content has likely
  changed since `last_seen_at`.
- Do not re-analyze `seen` entries when you have no reason to believe they
  changed.

When you fetch an entry, record the result so the watchlist snapshot updates.
Write a JSON file at `<run-directory>/watchlist-updates.json`:

```json
{
  "updates": [
    {
      "url": "https://github.com/example/repo",
      "accessible": true,
      "content": "Plain-text or extracted-markdown view of what you observed. The classifier normalizes whitespace and strips date churn before hashing — you do not need to strip them yourself.",
      "summary": "One-sentence description of what this resource currently is or has become."
    },
    {
      "url": "https://broken.example.com",
      "accessible": false
    }
  ]
}
```

- `accessible: true` must include both `content` (for fingerprinting) and `summary` (for the operator).
- `accessible: false` replaces the snapshot with `status: inaccessible`.
- Only include URLs that already exist in the watchlist. To add a new resource,
  edit `data/watchlist.yaml` directly with `url` and `added` fields — the
  snapshot will populate on the next run.
- Watchlist checks supplement open-ended discovery; do not let them dominate
  the run.

## Scope

- Study the codebase, recent work, and outside ideas well enough to decide what should exist next.
- Consult the watchlist for updates from known-valuable external resources.
- Create or refine concise, outcome-focused tasks.
- Keep the queue relevant, mixed, and non-duplicative.
- Treat the minimal-core, module-first architecture as a live goal.

## Creating Tasks

Use `pnpm kota task create` to scaffold new task files, then follow
`data/tasks/AGENTS.md` and the destination state's local contract.

## Finish

- If nothing should change, leave the queue untouched, write
  `exploration-rationale.json` with `decision: "noop"` and an explicit
  reason, and stop. Do not commit changes; the workflow's commit step
  will skip on its own.
- Otherwise follow the finish protocol in `workflows/AGENTS.md` — in
  particular, write `<run-directory>/commit-message.txt` after staging
  and ensure `exploration-rationale.json` reflects what you actually did.
