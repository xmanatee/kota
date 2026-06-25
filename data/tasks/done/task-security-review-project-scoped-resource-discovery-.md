---
id: task-security-review-project-scoped-resource-discovery-
title: Security review: Project-scoped resource discovery accepts an enforced scope selector, but the snapshot reader ignores it for knowledge, setup availability, and MCP config metadata. A caller scoped to one project can receive default-project discovery metadata such as knowledge entry titles and configured MCP server names/field lists.
status: done
priority: p2
area: security
summary: Project-scoped resource discovery accepts an enforced scope selector, but the snapshot reader ignores it for knowledge, setup availability, and MCP config metadata. A caller scoped to one project can receive default-project discovery metadata such as knowledge entry titles and configured MCP server names/field lists.
created_at: 2026-06-25T01:51:41.594Z
updated_at: 2026-06-25T02:08:01Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/resource-discovery/snapshot.ts
claim:

> Project-scoped resource discovery accepts an enforced scope selector, but the snapshot reader ignores it for knowledge, setup availability, and MCP config metadata. A caller scoped to one project can receive default-project discovery metadata such as knowledge entry titles and configured MCP server names/field lists.

## Desired Outcome

> Thread the selected scope/project through resource-discovery snapshot construction. Resolve knowledge, setup availability, and MCP config from the selected project store/root, or omit those project-specific sources when the selector cannot be resolved. Add a multi-project regression test proving a scoped discovery call for project B cannot surface project A/default project knowledge or MCP metadata.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-25T01-28-13-914Z-security-review-2255ky.

finding id: resource-discovery-scope-filter-ignored
candidate id: mcp-transport:src/modules/resource-discovery/catalog-runtime-candidates.ts:122
verdict: confirmed
rationale:

> Project-scoped clients inject the selector into resourceDiscovery.discover (src/core/server/project-scoped-kota-client.ts:219-223), and the provider forwards that filter to the snapshot reader (src/modules/resource-discovery/provider.ts:107-115). The snapshot reader accepts the filter as _filter, but only passes it to recall (src/modules/resource-discovery/snapshot.ts:154-178); knowledge search still uses getKnowledgeProvider().search(query, { scope: "all" }) (snapshot.ts:126-130), setup availability is computed from ctx.cwd (snapshot.ts:99-109, 167), and MCP metadata is read from configuredMcpServers(ctx.cwd) (snapshot.ts:177). Those project-specific sources can therefore reflect the default module context rather than the selected scope.

Evidence:

Evidence 1:



path: src/core/server/project-scoped-kota-client.ts

line: 220

excerpt:



> base.resourceDiscovery.discover(query, withScope(filter, selector))

Evidence 2:



path: src/modules/resource-discovery/provider.ts

line: 114

excerpt:



> const snapshot = await this.#readSnapshot(trimmed, resolvedFilter);

Evidence 3:



path: src/modules/resource-discovery/snapshot.ts

line: 157

excerpt:



> _filter: ResourceDiscoveryFilter,

Evidence 4:



path: src/modules/resource-discovery/snapshot.ts

line: 126

excerpt:



> getKnowledgeProvider().search(query, { scope: "all" })

Evidence 5:



path: src/modules/resource-discovery/snapshot.ts

line: 177

excerpt:



> mcpServers: configuredMcpServers(ctx.cwd),

Evidence 6:



path: src/modules/resource-discovery/catalog-runtime-candidates.ts

line: 123

excerpt:



> id: `mcp:${server.name}`,

Evidence 7:



path: src/modules/resource-discovery/catalog-runtime-candidates.ts

line: 153

excerpt:



> title: entry.title,

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Implemented in `src/modules/resource-discovery/snapshot.ts`: snapshot construction resolves the selected directory-backed scope/project and uses that project root/provider for knowledge, setup availability, MCP config metadata, and imported skill metadata; unresolved selectors omit those project-specific snapshot sources.
- Regression coverage in `src/modules/resource-discovery/snapshot-scope.test.ts` proves a project-B discovery snapshot returns project-B knowledge and MCP metadata, does not surface default-project metadata, uses project-B setup availability, and omits project-specific metadata for an unknown selector.
- Verification: `pnpm test src/modules/resource-discovery`, `pnpm typecheck`, `pnpm lint`, `pnpm validate-tasks`, and `checkSourceFileSize(process.cwd())` all passed.
