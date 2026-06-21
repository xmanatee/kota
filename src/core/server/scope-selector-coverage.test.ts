import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CLIENT_TYPE_FILES = [
  "src/core/server/kota-client.ts",
  "src/modules/approval-queue/client.ts",
  "src/modules/answer/client.ts",
  "src/modules/capture/client.ts",
  "src/modules/daemon-ops/client.ts",
  "src/modules/history/client.ts",
  "src/modules/inbound-signals/client.ts",
  "src/modules/knowledge/client.ts",
  "src/modules/memory/client.ts",
  "src/modules/owner-decisions/client.ts",
  "src/modules/owner-questions/client.ts",
  "src/modules/recall/client.ts",
  "src/modules/repo-tasks/client.ts",
  "src/modules/retract/client.ts",
  "src/modules/workflow-ops/client.ts",
  "src/modules/workflow-ops/client-trial-types.ts",
] as const;

const COMPATIBILITY_EXEMPTIONS = new Set([
  "src/core/server/kota-client.ts|forProject(projectId: string): KotaClient;",
  "src/core/server/kota-client.ts|readonly projectId: string;",
  "src/core/server/kota-client.ts|constructor(projectId: string, cause?: Error) {",
  "src/modules/daemon-ops/client.ts|| { ok: false; reason: \"not_found\"; projectId: string }",
  "src/modules/daemon-ops/client.ts|use(projectId: string | null): Promise<ProjectsUseResult>;",
  "src/modules/workflow-ops/client.ts|getDeadLetter(id: string, projectId?: string): Promise<WorkflowDeadLetterGetResult>;",
  "src/modules/workflow-ops/client.ts|dismissDeadLetter(id: string, reason: string, projectId?: string): Promise<WorkflowDeadLetterMutationResult>;",
  "src/modules/workflow-ops/client.ts|redriveDeadLetter(id: string, options: WorkflowDeadLetterRedriveOptions, projectId?: string): Promise<WorkflowDeadLetterMutationResult>;",
  "src/modules/workflow-ops/client.ts|exportDeadLetterDiagnostics(id: string, projectId?: string): Promise<EventJsonObject | null>;",
  "src/modules/workflow-ops/client-trial-types.ts|projectId?: string;",
]);

describe("scope selector client coverage", () => {
  it("keeps project-scoped client filters from regressing to projectId-only selectors", () => {
    const offenders: string[] = [];
    for (const file of CLIENT_TYPE_FILES) {
      const content = readFileSync(file, "utf8");
      content.split(/\r?\n/).forEach((line, index) => {
        const trimmed = line.trim();
        if (!/(?:^|[({\s])projectId\??:\s*string|forProject\(projectId: string/.test(trimmed)) {
          return;
        }
        const key = `${file}|${trimmed}`;
        if (COMPATIBILITY_EXEMPTIONS.has(key)) return;
        offenders.push(`${file}:${index + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
