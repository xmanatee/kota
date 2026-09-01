---
status: open
priority: p2
---
# Security review: browser_navigate returns an externally controlled page title to the agent, but the tool is omitted from the default injection-defense targets. A navigated page can therefore place prompt-injection text in its title without the screening applied to other browser content-ingest outputs.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/browser/browser-interaction-tools.ts
claim:

> browser_navigate returns an externally controlled page title to the agent, but the tool is omitted from the default injection-defense targets. A navigated page can therefore place prompt-injection text in its title without the screening applied to other browser content-ingest outputs.

## Desired Outcome

> Add browser_navigate to the default injection-defense targets and cover page-controlled titles with the existing autonomous-output screening tests. Alternatively, stop returning page-controlled title text from this interactive tool.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-01T21-40-58-459Z-security-review-ionkfm.

Confirmed by security-review workflow runs:

- 2026-09-01T21-40-58-459Z-security-review-ionkfm

finding id: security-browser-navigation-title-unscreened
candidate id: external-fetch:src/modules/browser/browser-interaction-tools.ts:42
verdict: confirmed
rationale:

> browser_navigate returns page.title(), which is controlled by the remote page. The tool is absent from DEFAULT_TARGET_TOOLS, and shouldScreenTool otherwise screens only results carrying external-mcp provenance. This local browser result carries no such provenance, so an autonomous browser_navigate response bypasses injection assessment and annotation.

Evidence:

Evidence 1:



path: src/modules/browser/browser-interaction-tools.ts

line: 50

excerpt:



> const page = await getPage(context);
> await page.goto(url, {
>   waitUntil: "networkidle",
>   timeout,
> });

Evidence 2:



path: src/modules/browser/browser-interaction-tools.ts

line: 58

excerpt:



> const title = await page.title();
> const finalUrl = page.url();
> return {
>   content: `Navigated to: ${finalUrl}\nTitle: ${title}`,
> };

Evidence 3:



path: src/modules/injection-defense/defense-middleware.ts

line: 19

excerpt:



> export const DEFAULT_TARGET_TOOLS = [
>   "web_fetch",
>   "web_search",
>   "http_request",
>   "read_document",
>   ...
>   "browser_get_text",
>   "x_post_read",
>   "rendered_article_read",
> ] as const;
