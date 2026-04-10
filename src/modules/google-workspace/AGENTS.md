# Google Workspace Module

This directory owns the Google Workspace capability pack — Gmail, Calendar, and Drive tools for agents.

## Auth Setup

This module uses OAuth 2.0 with a refresh token. One-time setup:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable the **Gmail API**, **Google Calendar API**, and **Google Drive API**.
3. Create an **OAuth 2.0 client** (type: Desktop app). Download the credentials JSON.
4. Run the OAuth consent flow to obtain a refresh token with the required scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/drive.readonly`
5. Store credentials in `.kota/config.json` under `modules.google-workspace`:

```json
{
  "modules": {
    "google-workspace": {
      "clientId": "$GOOGLE_CLIENT_ID",
      "clientSecret": "$GOOGLE_CLIENT_SECRET",
      "refreshToken": "$GOOGLE_REFRESH_TOKEN"
    }
  }
}
```

Values starting with `$` are resolved from environment variables. Alternatively, store the raw values directly in the config (project-scoped `.kota/config.json` is gitignored by default).

## Config

| Field          | Required | Default     | Description                          |
|----------------|----------|-------------|--------------------------------------|
| `clientId`     | yes      | —           | OAuth 2.0 client ID or `$ENV_VAR`   |
| `clientSecret` | yes      | —           | OAuth 2.0 client secret or `$ENV_VAR`|
| `refreshToken` | yes      | —           | OAuth 2.0 refresh token or `$ENV_VAR`|
| `userId`       | no       | `"me"`      | Gmail user ID                        |
| `calendarId`   | no       | `"primary"` | Google Calendar ID                   |

## Boundaries

- All tools are in the `productivity` tool group.
- Write tools (`gmail_send`, `calendar_create_event`) are classified as dangerous and queue for approval in autonomous mode.
- The access token is cached in-process and refreshed automatically before expiry.
- Credentials are never logged or included in error messages.
