# Jira Module

This directory owns the Jira Cloud task provider — an optional `TaskProvider` backed
by Jira's REST API v3 that lets KOTA's builder pull tasks directly from a Jira project.

- Requires `modules.jira.apiToken`, `modules.jira.userEmail`, and `modules.jira.baseUrl`
  (values or `$ENV_VAR` references).
- Only activated when `modules.jira.taskProvider.enabled` is `true`.
- Uses Jira REST API v3 (`/rest/api/3/`) with Basic auth; no npm dependencies.
- Credentials are never logged.
- Cloud only — base URL must end in `.atlassian.net`.

## Config

```json
{
  "modules": {
    "jira": {
      "apiToken": "$JIRA_API_TOKEN",
      "userEmail": "$JIRA_USER_EMAIL",
      "baseUrl": "$JIRA_BASE_URL",
      "taskProvider": {
        "enabled": true,
        "projectKey": "ENG",
        "jqlFilter": "assignee = currentUser()",
        "inProgressTransition": "In Progress",
        "doneTransition": "Done",
        "claimOnStart": true
      }
    }
  }
}
```

## Boundaries

- Does not own CLI commands or agent tools — this module only contributes a `TaskProvider`.
- Cloud only; no Jira Data Center support.
- Transition names in config must match exactly the workflow transition names in your Jira project.
- `claimOnStart: false` skips assigning the issue to the authenticated user on claim.
