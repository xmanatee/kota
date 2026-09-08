---
status: open
priority: p1
---
# Security review: Browser network authorization is shared across scopes. Configuration is stored globally, and an existing Chromium process reuses its launch-time proxy without checking the invoking scope's network profile. If that proxy permits a configured private origin, another scope configured as public-untrusted can navigate to that origin through the same process. Session-isolated browser contexts do not isolate this network permission.


## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/browser/browser-process.ts
claim:

> Browser network authorization is shared across scopes. Configuration is stored globally, and an existing Chromium process reuses its launch-time proxy without checking the invoking scope's network profile. If that proxy permits a configured private origin, another scope configured as public-untrusted can navigate to that origin through the same process. Session-isolated browser contexts do not isolate this network permission.

## Desired Outcome

> Resolve browser configuration from the invoking scope and bind each context's connections to that scope's network policy. Use separate browser/proxy instances where necessary, and prevent reuse across incompatible policies. Verify that a public-untrusted scope still rejects private destinations while another scope's configured-provider browser remains active.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-08T05-02-58-373Z-security-review-sy6r5y.

Confirmed by security-review workflow runs:

- 2026-09-08T05-02-58-373Z-security-review-sy6r5y

finding id: browser-shared-proxy-cross-scope-policy
candidate id: external-fetch:src/modules/browser/browser-interaction-tools.ts:42
verdict: confirmed
rationale:

> Direct code inspection confirms the boundary violation. src/modules/browser/browser-profile.ts:37-53 stores and snapshots one global profile without selecting by invoking scope. src/modules/browser/lifecycle.ts:112-124 copies that profile into each session resource; lines 94-100 create contexts without a separate network policy or proxy. src/modules/browser/browser-process.ts:28-34 reuses an existing browser or pending launch without comparing policies, and lines 37-44 attach the proxy at browser launch. src/modules/browser/network-proxy.ts:59-76 applies that proxy's captured profile to HTTP and CONNECT traffic. src/core/outbound-http/network-policy.ts:31-40 and 82-89 permit configured-provider origins without public-address restrictions, whereas public-untrusted rejects private destinations. Consequently, when a shared browser's configured-provider profile permits a private origin, a browser-enabled session from another scope inherits that permission despite its public-untrusted configuration. Storage-path ownership and session-context isolation do not enforce network isolation. Confirmation rests on the production data flow; no live exploitation was attempted.

Evidence:

Evidence 1:



path: src/modules/browser/browser-interaction-tools.ts

line: 50

excerpt:



> const page = await getPage(context);
>     await page.goto(url, {

Evidence 2:



path: src/modules/browser/index.ts

line: 197

excerpt:



> const profile = resolveProfile(ctx);
>     configureBrowserProfile(profile, {
>       scopeId: deriveDirectoryScopeId(ctx.cwd),
>       scopeRoot: ctx.cwd,
>     });

Evidence 3:



path: src/modules/browser/browser-profile.ts

line: 52

excerpt:



> export function snapshotConfiguredBrowserProfile(): BrowserProfileSnapshot {
>   return { profile, profileOwner };
> }

Evidence 4:



path: src/modules/browser/lifecycle.ts

line: 94

excerpt:



> const activeBrowser = await ensureBrowserProcess(resource.profile);
>   const storagePath = resolveStoragePath(resource);
>   const options: { storageState?: string } = {};
>   if (storagePath && existsSync(storagePath)) {
>     options.storageState = storagePath;
>   }
>   const createdContext = await activeBrowser.newContext(options);

Evidence 5:



path: src/modules/browser/browser-process.ts

line: 28

excerpt:



> if (browser?.isConnected()) return browser;
>   if (browserLaunch) return browserLaunch;
>
>   browserLaunch = (async () => {
>     const playwright = await ensurePlaywright();
>     const proxy = await startBrowserNetworkProxy({
>       profile: options.networkProfile,
>     });

Evidence 6:



path: src/core/outbound-http/network-policy.ts

line: 31

excerpt:



> switch (profile.name) {
>     case "public-untrusted":
>       await resolvePublicOutboundAddresses(url.hostname, resolveAddresses);
>       return;
>     case "configured-provider":
>     case "oauth-protected-resource":
>       if (!profile.allowedOrigins.includes(url.origin)) {
>         throw new OutboundHttpTargetPolicyError(`target origin ${url.origin} is not selected by the ${profile.name} profile`);
>       }
>       return;
