# Linear Module

This directory owns the Linear Issues task provider — an optional `TaskProvider` backed
by Linear's GraphQL API that lets KOTA's builder pull tasks directly from a Linear team.

- Requires `modules.linear.apiKey` (API key or `$ENV_VAR` reference).
- Only activated when `modules.linear.taskProvider.enabled` is `true`.
- Uses Linear's official GraphQL API (`https://api.linear.app/graphql`); no npm dependencies.
- API key is never logged.

## Files

- `index.ts` — `KotaModule` definition; wires config, resolves the API key, and registers
  `LinearTaskProvider` in `onLoad` when `taskProvider.enabled` is set.
- `task-provider.ts` — `LinearTaskProvider` class implementing the `TaskProvider` interface
  backed by Linear Issues; issues cached at init, mutations (claim/complete/add) fire
  async Linear API calls.
- `linear-task-provider.test.ts` — unit tests covering init, list, claim, complete, add,
  archiveCompleted, and the onLoad integration.

## Config

```json
{
  "modules": {
    "linear": {
      "apiKey": "${LINEAR_API_KEY}",
      "taskProvider": {
        "enabled": true,
        "teamKey": "ENG",
        "labelFilter": "kota-task",
        "inProgressState": "In Progress",
        "doneState": "Done"
      }
    }
  }
}
```

## Boundaries

- Does not own CLI commands or agent tools — this module only contributes a `TaskProvider`.
- Two-way sync (pushing local tasks to Linear) is out of scope.
- Issue state names in config must match exactly the workflow state names in Linear.
