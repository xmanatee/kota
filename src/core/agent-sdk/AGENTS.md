# Agent SDK

This directory contains the packaged Claude Code backend integration used by KOTA.

- Keep the executor, types, and prompt integration aligned with the actual Claude Agent SDK contract.
- Changes here affect direct runs, delegated runs, and autonomous workflows.
- The SDK's `PermissionResult` TS type marks `updatedInput` optional on the
  `allow` branch, but the SDK's runtime zod schema (`_OA`) rejects responses
  without it. A `canUseTool` callback that returns `{ behavior: "allow" }`
  without `updatedInput` breaks every tool call. Route all callbacks through
  `normalizePermissionResult` / `normalizeCanUseTool` (applied automatically
  by `buildQueryOptions`); do not pass a raw `canUseTool` to `sdkQuery`.
