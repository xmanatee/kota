---
id: task-google-workspace-module
title: Add Google Workspace module for Gmail, Calendar, and Drive access from agents
status: done
priority: p3
area: modules
summary: Agents have no first-class tools for Google Workspace. A contributed module wrapping Gmail, Calendar, and Drive APIs would let builders and explorers read/write calendar events, emails, and documents without ad-hoc shell commands.
created_at: 2026-04-09T00:15:00Z
updated_at: 2026-04-09T00:15:00Z
---

## Problem

Agents working on productivity or scheduling workflows must use shell commands or browser fetch to interact with Google Workspace. There is no first-class KOTA module providing Gmail, Calendar, or Drive tools. The GitHub module provides the right pattern: a contributed module that wraps a third-party API and registers named tools for agents to use. Google Workspace is a common enough surface (calendar, email, docs) that wrapping it once benefits many workflows.

## Desired Outcome

A `google-workspace` module under `src/modules/google-workspace/` that registers tools:
- `gmail_list_messages`, `gmail_get_message`, `gmail_send`
- `calendar_list_events`, `calendar_create_event`
- `drive_list_files`, `drive_read_file`

Auth via Google OAuth or service account JSON stored in the secrets module. Tools registered in a `productivity` tool group.

## Constraints

- Follows the same ToolDef + group declaration pattern as the GitHub module
- Uses the existing secrets module for credential storage
- No new global HTTP client dependency; use Node fetch or the `googleapis` npm package if viable
- Auth setup documented in a local AGENTS.md or inline comments

## Done When

- Module is loadable and contributes Google Workspace tools
- Agent can call `gmail_list_messages` and receive inbox items in the response
- `calendar_list_events` returns upcoming events for the authenticated account
- Auth configuration is documented and follows the secrets module pattern
