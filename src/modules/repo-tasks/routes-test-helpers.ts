import { mkdirSync, writeFileSync } from "node:fs";
import { type IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { vi } from "vitest";
import { resetProviderRegistry } from "#core/modules/provider-registry.js";
import type { RepoTaskMutationTarget } from "./repo-task-mutation-boundary.js";
import {
  createRepoTaskRuntimeSandbox,
  repoTaskRuntimeSandboxTarget,
} from "./repo-task-mutation-test-support.js";
import type { RepoTaskState } from "./repo-tasks-domain.js";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type JsonObject = { readonly [key: string]: JsonValue };

export function makeScopeRoot(): string {
  const scopeDir = join(
    tmpdir(),
    `kota-task-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  return createRepoTaskRuntimeSandbox(
    scopeDir,
    `route-test-${Math.random().toString(36).slice(2, 8)}`,
  ).workspaceRoot;
}

export function resetRouteTestAuthority(): void {
  resetProviderRegistry();
}

export function mutationTarget(repoRoot: string): RepoTaskMutationTarget {
  return repoTaskRuntimeSandboxTarget(repoRoot);
}

export function writeTaskFile(
  repoRoot: string,
  state: RepoTaskState,
  slug: string,
  frontmatter: Record<string, string>,
): void {
  const dir = state === "done" || state === "dropped"
    ? join(repoRoot, "data", "tasks", "archive")
    : join(repoRoot, "data", "tasks");
  mkdirSync(dir, { recursive: true });
  const id = slug.startsWith("task-") ? slug : `task-${slug}`;
  const status = frontmatter.status ?? state;
  const title = frontmatter.title ?? id;
  const priority = frontmatter.priority ?? "p2";
  const dependsOn = frontmatter.depends_on;
  const fm = state === "done" || state === "dropped"
    ? `status: ${status}`
    : [
        `status: ${status}`,
        `priority: ${priority}`,
        ...(dependsOn === undefined ? [] : [`depends_on: ${dependsOn}`]),
      ].join("\n");
  writeFileSync(
    join(dir, `${id}.md`),
    `---\n${fm}\n---\n\n# ${title}\n\n## Problem\n\nSome problem.\n`,
  );
}

export function mockResponse() {
  const result: { status: number; body: JsonValue } = { status: 0, body: null };
  const res = new ServerResponse(Readable.from([]) as IncomingMessage);
  res.setHeader = vi.fn(() => res) as ServerResponse["setHeader"];
  res.writeHead = ((statusCode: number) => {
    result.status = statusCode;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((data?: string | Uint8Array) => {
    if (typeof data === "string") {
      result.body = JSON.parse(data);
    } else if (data !== undefined) {
      result.body = JSON.parse(Buffer.from(data).toString("utf-8"));
    }
    return res;
  }) as ServerResponse["end"];
  return { res, result };
}

export function mockRequest(body: JsonObject): IncomingMessage {
  const data = Buffer.from(JSON.stringify(body));
  return Readable.from([data]) as IncomingMessage;
}
