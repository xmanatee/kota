---
id: task-security-review-a2a-push-notification-config-respo
title: Security review: A2A push notification config responses redact token and authentication credentials but return callback URLs with query strings unchanged, so callback secrets embedded in URL parameters are exposed through create/get/list config responses.
status: done
priority: p2
area: security
summary: A2A push notification config responses redact token and authentication credentials but return callback URLs with query strings unchanged, so callback secrets embedded in URL parameters are exposed through create/get/list config responses.
created_at: 2026-06-22T08:06:52.735Z
updated_at: 2026-06-22T08:16:31Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/a2a-channel/push-notification-storage.ts
claim:

> A2A push notification config responses redact token and authentication credentials but return callback URLs with query strings unchanged, so callback secrets embedded in URL parameters are exposed through create/get/list config responses.

## Desired Outcome

> Keep the full callback URL only in private storage/delivery, but return a redacted URL from create/get/list responses with search and hash removed or replaced. Add regression coverage proving query secrets do not appear in API responses, logs, or errors.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Resolution

Create/get/list responses now project callback URLs through the same redaction
helper used for delivery warnings, replacing query strings with `?...` and
removing fragments. Stored configs and outbound delivery keep using the full
callback URL. `postWithRetry` also redacts the raw callback URL out of fetch
error messages when a caller supplies a redacted `logUrl`.

## Source / Intent

Created by security-review workflow run 2026-06-22T06-52-58-889Z-security-review-ajrklr.

finding id: a2a-push-config-query-secret-disclosure
candidate id: secret-handling:src/modules/a2a-channel/push-notification-configs.test.ts:37
verdict: confirmed
rationale:

> Confirmed. create/get/list return StoredPushNotificationConfig.url unchanged via redactPushNotificationConfig, while only token and authentication.credentials are redacted. Existing tests explicitly expect a callback URL containing ?secret=query-token in the response.

Evidence:

Evidence 1:

path: src/modules/a2a-channel/push-notification-configs.test.ts

line: 37

excerpt:

> url: "https://callback.example.test/a2a?secret=query-token",

Evidence 2:

path: src/modules/a2a-channel/push-notification-configs.test.ts

line: 49

excerpt:

> url: "https://callback.example.test/a2a?secret=query-token",

Evidence 3:

path: src/modules/a2a-channel/push-notification-storage.ts

line: 58

excerpt:

> url: config.url,

Evidence 4:

path: src/modules/a2a-channel/push-notification-storage.ts

line: 59

excerpt:

> ...(config.token !== null ? { token: REDACTED_SECRET } : {}),

Evidence 5:

path: src/modules/a2a-channel/push-notifications.ts

line: 89

excerpt:

> return redactPushNotificationConfig(stored);

Evidence 6:

path: src/modules/a2a-channel/push-notifications.ts

line: 161

excerpt:

> configs: selected.map(redactPushNotificationConfig),

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- `pnpm exec vitest run src/modules/a2a-channel/push-notification-configs.test.ts src/modules/a2a-channel/push-notification-delivery.test.ts src/modules/notification/post-with-retry.test.ts` passed.
- `pnpm exec vitest run src/strict-types-policy.integration.test.ts` passed.
- `pnpm exec biome check src/modules/a2a-channel/push-notification-callback-url.ts src/modules/a2a-channel/push-notification-delivery.ts src/modules/a2a-channel/push-notification-storage.ts src/modules/a2a-channel/push-notifications.ts src/modules/a2a-channel/push-notification-configs.test.ts src/modules/a2a-channel/push-notification-delivery.test.ts src/modules/notification/index.ts src/modules/notification/post-with-retry.test.ts` passed.
- `pnpm run typecheck` passed.
