import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { createStepContext } from "#core/workflow/steps/step-context.js";
import { unexpectedWorkflowAgentHarnessRun } from "#core/workflow/testing/agent-harness-runner.js";
import { unexpectedWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";
import { describeInvestigation, investigationArtifact } from "./finding-steps.js";
import type { SecurityInvestigationOutput } from "./security-review-output.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "review-handoff-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fixture(id = "standalone-instance-lock-credential-disclosure", excerpt = "Authorization: Bearer fixture-access-value") {
  const sourceDir = join(root, ".kota/runs/retained");
  const agentDir = join(root, "runtime/agent");
  const input: SecurityInvestigationOutput = {
    coverage: [], findings: [{
      id, candidateId: "secret-handling:src/token-store.ts:1", existingTaskId: null,
      productionOwner: "core/workflow", violatedInvariant: "runtime-credentials-must-not-enter-agent-context",
      repair: "Constrain the read boundary", exploitPreconditions: "An isolated reviewer reads host credentials",
      evidenceIdentity: "credential-read-v1", evidenceLineage: { kind: "unchanged", reference: "credential-boundary-v1", rationale: "Same read boundary" },
      claim: "The credential boundary permits an unauthorized read", severity: "high", affectedPath: "src/token-store.ts",
      evidence: [{ path: "src/token-store.ts", line: 1, excerpt }],
      recommendedOutcome: "Keep canonical credentials private",
    }],
  };
  const reference = investigationArtifact.write(sourceDir, input);
  investigationArtifact.write(join(root, ".kota/runs/unrelated"), {
    coverage: [], findings: [{ ...input.findings[0]!, id: "unrelated-private-finding" }],
  });
  const bus = new EventBus();
  const trigger = { event: "autonomy.security-review.requested", schemaRef: null, payload: {} };
  const ctx = createStepContext({
    id: "current", workflow: "security-review", definitionPath: "workflow.ts", trigger,
    startedAt: new Date().toISOString(), status: "running", runDir: ".kota/runs/current", steps: [],
  }, trigger, undefined, { "record-investigation-findings": reference }, {}, [], {
    workspaceRoot: root, scopeRoot: root, bus, pbus: new ScopedEventBus(bus, "test"),
    store: new WorkflowRunStore(root), readRuntimeState: readEmptyTestWorkflowRuntimeState,
    runAgentHarness: unexpectedWorkflowAgentHarnessRun, runCommand: unexpectedWorkflowCommandRun,
    runtimeResources: { profileId: "test", env: {}, agentRunDir: agentDir },
  });
  return { ctx: { ...ctx, runBlocking: async () => { throw new Error("Unexpected blocking operation"); } }, sourceDir, agentDir, input, reference };
}

it.each([
  { excerpt: "Authorization: Bearer fixture-access-value", redactedExcerpt: "Authorization: [redacted] [redacted]" },
  { excerpt: '{"token":"fixture-sensitive-value","password":"fixture-password-value"}', redactedExcerpt: '{"token":"[redacted]","password":"[redacted]"}' },
])("refreshes an agent-readable handoff with redaction and unchanged lineage: $excerpt", async ({ excerpt, redactedExcerpt }) => {
  const { ctx, sourceDir, agentDir, input, reference } = fixture(undefined, excerpt);
  const sourcePath = join(sourceDir, "security-review-investigation.json");
  const original = readFileSync(sourcePath, "utf8");
  const first = await describeInvestigation.run(ctx);
  writeFileSync(first.artifactPath, "stale agent output");
  const refreshed = await describeInvestigation.run(ctx);
  expect(refreshed.artifactPath).toBe(join(agentDir, "security-review-investigation.json"));
  // A real restricted subprocess reads the export and cannot read its source.
  const text = execFileSync(process.execPath, ["--permission", `--allow-fs-read=${agentDir}`, "-e", `
    const fs = require('node:fs');
    try { fs.readFileSync(process.argv[2]); process.exit(2); }
    catch (error) { if (error.code !== 'ERR_ACCESS_DENIED') throw error; }
    process.stdout.write(fs.readFileSync(process.argv[1]));
  `, refreshed.artifactPath, sourcePath], { encoding: "utf8" });
  expect(text).not.toContain("fixture-access-value");
  expect(text).not.toContain("fixture-sensitive-value");
  expect(text).not.toContain("fixture-password-value");
  expect(text).not.toContain("unrelated-private-finding");
  expect(readdirSync(agentDir)).toEqual(["security-review-investigation.json"]);
  const exported = JSON.parse(text);
  expect(exported).toMatchObject({ untrusted: true, redacted: true, input: { source: reference } });
  expect(exported.input.findings[0]).toEqual({ ...input.findings[0], evidence: [{
    path: "src/token-store.ts", line: 1, excerpt: redactedExcerpt,
  }] });
  expect(readFileSync(sourcePath, "utf8")).toBe(original);
});

it.each(["missing", "corrupt"])("rejects %s retained source instead of using a stale export", async (failure) => {
  const { ctx, sourceDir } = fixture();
  await describeInvestigation.run(ctx);
  const sourcePath = join(sourceDir, "security-review-investigation.json");
  if (failure === "missing") rmSync(sourcePath);
  else writeFileSync(sourcePath, "{}");
  await expect(Promise.resolve().then(() => describeInvestigation.run(ctx))).rejects.toThrow(
    failure === "missing" ? /ENOENT/ : /integrity mismatch/,
  );
});

it("rejects a finding whose original identity would be redacted", async () => {
  const { ctx } = fixture("finding-token=fixture-sensitive-value");
  await expect(Promise.resolve().then(() => describeInvestigation.run(ctx))).rejects.toThrow(/identity requires redaction/);
});
