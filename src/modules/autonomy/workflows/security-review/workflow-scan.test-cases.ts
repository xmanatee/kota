import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  scanSecurityReviewCandidates,
  securityReviewDueTargetsFromPayload,
} from "./security-review.js";
import { SecurityReviewProjectFixture } from "./workflow-test-fixture.js";

function externalFetchDueTargets(
  fixture: SecurityReviewProjectFixture,
  paths: readonly string[],
) {
  return securityReviewDueTargetsFromPayload(fixture.projectDir, {
    changedSurfaces: [{ surface: "external-fetch", paths: [...paths] }],
  });
}

export function describeSecurityReviewScanTests(): void {
  describe("candidate scanning", () => {
    let fixture: SecurityReviewProjectFixture;

    beforeEach(() => {
      fixture = new SecurityReviewProjectFixture();
    });

    afterEach(() => {
      fixture.cleanup();
    });

    it("discovers repo-local candidates across KOTA security-sensitive surfaces", () => {
      fixture.writeProjectFile(
        "src/modules/approval-queue/index.ts",
        "const approval = canUseTool({ Authorization: token });\n",
      );
      fixture.writeProjectFile(
        "src/core/daemon/daemon-control.ts",
        "router.post('/api/tasks/:id/move', handler);\n",
      );
      fixture.writeProjectFile(
        "src/modules/shell/index.ts",
        "spawnSync(command, { shell: true });\n",
      );
      fixture.writeProjectFile(
        "src/modules/web-access/web-fetch.ts",
        "await fetch(url, { headers });\n",
      );
      fixture.writeProjectFile(
        "src/modules/secrets/index.ts",
        "const apiKey = await get_secret('OPENAI_API_KEY');\n",
      );
      fixture.writeProjectFile(
        "src/core/mcp/client.ts",
        "const transport = new McpClient({ sse: true, stdio: false });\n",
      );
      fixture.writeProjectFile(
        "src/modules/autonomy/workflows/builder/workflow.ts",
        "moveTaskById(projectDir, id, 'done');\n",
      );

      const result = scanSecurityReviewCandidates(fixture.projectDir, {
        maxCandidates: 7,
        maxCandidatesPerSurface: 1,
      });

      expect(result.truncated).toBe(false);
      expect(result.candidates).toHaveLength(7);
      expect(result.candidates.map((candidate) => candidate.surface).sort()).toEqual([
        "auth-approval-boundary",
        "daemon-control-route",
        "external-fetch",
        "mcp-transport",
        "secret-handling",
        "task-workflow-mutation",
        "tool-execution",
      ]);
      expect(result.candidates.every((candidate) => candidate.excerpt.length > 0)).toBe(true);
    });

    it("prioritizes source implementation candidates over generated and prose noise", () => {
      const noisyMatch =
        "Authorization Bearer /api/control spawnSync fetch('https://example.test') get_secret SECRET Mcp stdio moveTaskById workflow git add data/tasks\n";
      for (let index = 0; index < 5; index += 1) {
        fixture.writeProjectFile(
          `clients/apple/.build/generated/contract-fixture-${index}.json`,
          noisyMatch,
        );
        fixture.writeProjectFile(`data/tasks/done/noisy-security-note-${index}.md`, noisyMatch);
      }
      fixture.writeProjectFile(
        "src/modules/approval-queue/index.ts",
        "const approval = canUseTool({ Authorization: token });\n",
      );
      fixture.writeProjectFile(
        "src/core/daemon/daemon-control.ts",
        "router.post('/api/tasks/:id/move', handler);\n",
      );
      fixture.writeProjectFile(
        "src/modules/execution/shell.ts",
        "spawnSync(command, { shell: true });\n",
      );
      fixture.writeProjectFile(
        "src/modules/web-access/web-fetch.ts",
        "await fetch(url, { headers });\n",
      );
      fixture.writeProjectFile(
        "src/modules/secrets/index.ts",
        "const apiKey = await get_secret('OPENAI_API_KEY');\n",
      );
      fixture.writeProjectFile(
        "src/core/mcp/client.ts",
        "const transport = new McpClient({ sse: true, stdio: false });\n",
      );
      fixture.writeProjectFile(
        "src/modules/autonomy/workflows/builder/workflow.ts",
        "moveTaskById(projectDir, id, 'done');\n",
      );

      const result = scanSecurityReviewCandidates(fixture.projectDir);
      const paths = result.candidates.map((candidate) => candidate.path);

      expect(result.maxCandidates).toBe(35);
      expect(result.maxCandidatesPerSurface).toBe(5);
      expect(paths).toEqual(
        expect.arrayContaining([
          "src/modules/approval-queue/index.ts",
          "src/core/daemon/daemon-control.ts",
          "src/modules/execution/shell.ts",
          "src/modules/web-access/web-fetch.ts",
          "src/modules/secrets/index.ts",
          "src/core/mcp/client.ts",
          "src/modules/autonomy/workflows/builder/workflow.ts",
        ]),
      );
    });

    it("prioritizes due targets before lower-priority full-tree candidates and reports misses", () => {
      fixture.writeProjectFile(
        "src/modules/web-access/a-full-tree.ts",
        "await fetch('https://noise.example');\n",
      );
      fixture.writeProjectFile("src/modules/web-access/z-due.ts", "await fetch(url, { headers });\n");
      fixture.writeProjectFile("notes/no-matcher.md", "No security-sensitive content here.\n");
      fixture.writeProjectFile("node_modules/generated.ts", "await fetch('https://ignored.example');\n");

      const dueTargets = externalFetchDueTargets(fixture, [
        "src/modules/web-access/z-due.ts",
        "notes/no-matcher.md",
        "node_modules/generated.ts",
        "../outside.ts",
      ]);

      const result = scanSecurityReviewCandidates(fixture.projectDir, {
        maxCandidates: 1,
        maxCandidatesPerSurface: 1,
        dueTargets,
      });

      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        "src/modules/web-access/z-due.ts",
      ]);
      expect(result.dueTargets).toMatchObject({
        total: 3,
        matched: 1,
        missed: 2,
      });
      expect(result.dueTargets.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            surface: "external-fetch",
            path: "src/modules/web-access/z-due.ts",
            status: "matched",
          }),
          expect.objectContaining({
            surface: "external-fetch",
            path: "notes/no-matcher.md",
            status: "missed",
            reason: "no-matcher",
          }),
          expect.objectContaining({
            surface: "external-fetch",
            path: "node_modules/generated.ts",
            status: "missed",
            reason: "skipped-directory",
          }),
        ]),
      );
    });

    it("selects one representative per due target before enforcing per-surface caps", () => {
      fixture.writeProjectFile(
        "src/modules/web-access/a-due.ts",
        "await fetch(first);\nawait fetch(second);\n",
      );
      fixture.writeProjectFile("src/modules/web-access/b-due.ts", "await fetch(second);\n");
      fixture.writeProjectFile("src/modules/web-access/c-noise.ts", "await fetch(third);\n");

      const dueTargets = externalFetchDueTargets(fixture, [
        "src/modules/web-access/a-due.ts",
        "src/modules/web-access/b-due.ts",
      ]);

      const result = scanSecurityReviewCandidates(fixture.projectDir, {
        maxCandidates: 2,
        maxCandidatesPerSurface: 1,
        dueTargets,
      });

      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        "src/modules/web-access/a-due.ts",
        "src/modules/web-access/b-due.ts",
      ]);
      expect(result.dueTargets).toMatchObject({
        total: 2,
        matched: 2,
        missed: 0,
      });
    });

    it("reports due target cap misses when the hard global cap is exhausted", () => {
      fixture.writeProjectFile("src/modules/web-access/a-due.ts", "await fetch(first);\n");
      fixture.writeProjectFile("src/modules/web-access/b-due.ts", "await fetch(second);\n");

      const dueTargets = externalFetchDueTargets(fixture, [
        "src/modules/web-access/a-due.ts",
        "src/modules/web-access/b-due.ts",
      ]);

      const result = scanSecurityReviewCandidates(fixture.projectDir, {
        maxCandidates: 1,
        maxCandidatesPerSurface: 1,
        dueTargets,
      });

      expect(result.candidates.map((candidate) => candidate.path)).toEqual([
        "src/modules/web-access/a-due.ts",
      ]);
      expect(result.dueTargets).toMatchObject({
        total: 2,
        matched: 1,
        missed: 1,
      });
      expect(result.dueTargets.diagnostics).toContainEqual(
        expect.objectContaining({
          surface: "external-fetch",
          path: "src/modules/web-access/b-due.ts",
          status: "missed",
          reason: "candidate-cap",
        }),
      );
    });

    it("uses surface-specific source priority before lexicographic path order", () => {
      for (let index = 0; index < 5; index += 1) {
        fixture.writeProjectFile(
          `src/core/tools/tool-noise-${index}.ts`,
          "spawnSync(command, { shell: true });\n",
        );
        fixture.writeProjectFile(
          `src/modules/browser/fetch-noise-${index}.ts`,
          "await fetch('https://example.test');\n",
        );
        fixture.writeProjectFile(
          `src/core/config/secrets-noise-${index}.ts`,
          "const value = process.env.SECRET_TOKEN;\n",
        );
      }
      fixture.writeProjectFile(
        "src/modules/execution/shell.ts",
        "spawnSync(command, { shell: true });\n",
      );
      fixture.writeProjectFile(
        "src/modules/web-access/web-fetch.ts",
        "await fetch(url, { headers });\n",
      );
      fixture.writeProjectFile(
        "src/modules/secrets/index.ts",
        "const apiKey = await get_secret('OPENAI_API_KEY');\n",
      );

      const result = scanSecurityReviewCandidates(fixture.projectDir);
      const paths = result.candidates.map((candidate) => candidate.path);

      expect(paths).toEqual(
        expect.arrayContaining([
          "src/modules/execution/shell.ts",
          "src/modules/web-access/web-fetch.ts",
          "src/modules/secrets/index.ts",
        ]),
      );
    });
  });
}
