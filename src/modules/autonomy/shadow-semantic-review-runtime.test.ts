import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  type AgentHarnessResult,
  type AgentHarnessRunOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { resolveAgentRuntime } from "#core/model/preset.js";
import {
  buildShadowSemanticReviewPrompt,
  parseShadowSemanticReviewerResponse,
  resolveShadowSemanticReviewRunContract,
  runShadowSemanticReview,
  workflowMutationArtifacts,
} from "./shadow-semantic-review.js";
import {
  baseShadowReviewDeclaration,
  git,
  makeShadowReviewContext,
  makeShadowReviewDirs,
  writeProjectFile,
} from "./shadow-semantic-review-test-support.js";

describe("shadow semantic review runtime", () => {
  afterEach(() => {
    clearAgentHarnessRegistryForTest();
  });

  it("builds prompts from declared artifacts without hidden context leakage", () => {
    const declaration = baseShadowReviewDeclaration();
    const prompt = buildShadowSemanticReviewPrompt(declaration, {
      kind: "target",
      target: {
        id: "target-one",
        kind: "task-queue",
        summary: "Only this summary is reviewable.",
        artifacts: [{ path: "artifact:one", content: "reviewable content" }],
      },
    });

    expect(prompt).toContain("artifact:one");
    expect(prompt).toContain("reviewable content");
    expect(prompt).not.toContain("hidden-secret-from-stepOutputs");
    expect(prompt).toContain("Do not infer from hidden reasoning");
  });

  it("previews unstaged and untracked workflow mutations without touching the index", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "shadow-review-git-"));
    git(workspaceRoot, ["init"]);
    git(workspaceRoot, ["config", "user.email", "kota@example.test"]);
    git(workspaceRoot, ["config", "user.name", "KOTA Test"]);
    git(workspaceRoot, ["config", "commit.gpgsign", "false"]);
    writeProjectFile(
      workspaceRoot,
      "data/tasks/blocked/task-old.md",
      "## Resources\n- https://example.com/old\n",
    );
    git(workspaceRoot, ["add", "-A"]);
    git(workspaceRoot, ["commit", "-m", "initial"]);

    writeProjectFile(
      workspaceRoot,
      "data/tasks/blocked/task-old.md",
      "## Resources\n- https://example.com/updated\n\nUpdated source decision.\n",
    );
    writeProjectFile(workspaceRoot, "data/tasks/ready/task-new.md", "## Problem\nNew queue task.\n");

    const artifacts = new Map(
      workflowMutationArtifacts(workspaceRoot).map((artifact) => [artifact.path, artifact.content]),
    );

    expect(artifacts.get("git:workflow-mutation-files")).toContain(
      "data/tasks/blocked/task-old.md",
    );
    expect(artifacts.get("git:workflow-mutation-files")).toContain("data/tasks/ready/task-new.md");
    const diff = artifacts.get("git:workflow-mutation-diff") ?? "";
    expect(diff).toContain(
      "diff --git a/data/tasks/blocked/task-old.md b/data/tasks/blocked/task-old.md",
    );
    expect(diff).toContain("Updated source decision.");
    expect(diff).toContain("diff --git a/data/tasks/ready/task-new.md b/data/tasks/ready/task-new.md");
    expect(diff).toContain("new file mode");
    expect(diff).toContain("New queue task.");
    expect(git(workspaceRoot, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("writes advisory fail artifacts without blocking the workflow outcome", async () => {
    const { workspaceRoot, runDirPath } = makeShadowReviewDirs();
    const result = await runShadowSemanticReview({
      ctx: makeShadowReviewContext(workspaceRoot, runDirPath),
      declaration: baseShadowReviewDeclaration(),
      invoker: async () => ({
        text: JSON.stringify({
          decision: "fail",
          summary: "The sorted task duplicates existing work.",
          citedArtifacts: ["artifact:diff"],
          findings: [
            {
              severity: "critical",
              summary: "Duplicate task was created without a source trace.",
              citedArtifacts: ["artifact:diff"],
              falsePositive: false,
            },
          ],
        }),
        streamedText: "",
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "complete", usd: 0.02 },
        },
        isError: false,
      }),
    });

    expect(result).toMatchObject({ status: "reviewed", decision: "fail" });
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf-8"));
    expect(artifact).toMatchObject({
      status: "reviewed",
      decision: "fail",
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "complete", usd: 0.02 },
      },
      target: { id: "target-one" },
    });
    expect(artifact.findings[0].severity).toBe("critical");
  });

  it("records skipped target resolution as a shadow artifact", async () => {
    const { workspaceRoot, runDirPath } = makeShadowReviewDirs();
    const result = await runShadowSemanticReview({
      ctx: makeShadowReviewContext(workspaceRoot, runDirPath),
      declaration: baseShadowReviewDeclaration({
        targetResolver: () => ({
          kind: "skip",
          reason: "No changed task or source-decision target.",
          citedArtifacts: ["metadata:inspect"],
        }),
      }),
      invoker: async () => {
        throw new Error("invoker should not run for skipped targets");
      },
    });

    expect(result).toMatchObject({ status: "skipped", decision: "skip" });
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf-8"));
    expect(artifact.skippedReason).toBe("No changed task or source-decision target.");
  });

  it("records malformed advisory reviewer output without throwing", async () => {
    const { workspaceRoot, runDirPath } = makeShadowReviewDirs();
    const result = await runShadowSemanticReview({
      ctx: makeShadowReviewContext(workspaceRoot, runDirPath),
      declaration: baseShadowReviewDeclaration(),
      invoker: async () => ({
        text: "not json",
        streamedText: "",
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
      }),
    });

    expect(result).toMatchObject({ status: "malformed", decision: "error" });
    const artifact = JSON.parse(readFileSync(result.artifactPath, "utf-8"));
    expect(artifact.error).toContain("invalid JSON");
  });

  it("parses false-positive annotations from reviewer JSON", () => {
    const response = parseShadowSemanticReviewerResponse(JSON.stringify({
      decision: "warn",
      summary: "One advisory catch was later annotated.",
      citedArtifacts: ["artifact:diff"],
      findings: [
        {
          severity: "warning",
          summary: "Possible duplicate.",
          citedArtifacts: ["artifact:diff"],
          falsePositive: true,
          falsePositiveReason: "Existing task was already closed.",
        },
      ],
    }));

    expect(response.findings[0]).toMatchObject({
      falsePositive: true,
      falsePositiveReason: "Existing task was already closed.",
    });
  });

  it("declares and launches the shadow reviewer through one resolved contract", async () => {
    const harness: AgentHarness = {
      name: "shadow-review-contract-fixture",
      description: "shadow review contract fixture",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      toolControl: "native",
      nativeAbortQuarantine: "confirmed-stop",
      unsupportedRunOptions: [],
      run: async () => ({
        text: "unused",
        streamedText: "",
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
      }),
    };
    registerAgentHarness(harness);
    const { workspaceRoot, runDirPath } = makeShadowReviewDirs();
    const runtime = {
      ...resolveAgentRuntime(undefined, {}),
      harness: harness.name,
    };
    const declaration = baseShadowReviewDeclaration({
      reviewer: {
        ...baseShadowReviewDeclaration().reviewer,
        model: "shadow-model",
        effort: "high",
      },
    });
    const runAgentHarness = vi.fn(async (
      _harness: AgentHarness,
      _options: Omit<AgentHarnessRunOptions, "abortController">,
    ): Promise<AgentHarnessResult> => ({
      text: JSON.stringify({
        decision: "pass",
        summary: "The declared target is sound.",
        citedArtifacts: ["artifact:diff"],
        findings: [],
      }),
      streamedText: "",
      turns: 1,
      usage: {
        tokens: { state: "unknown" },
        cost: { state: "unknown" },
      },
      isError: false,
    }));
    const ctx = {
      ...makeShadowReviewContext(workspaceRoot, runDirPath),
      agentRuntime: runtime,
      runAgentHarness,
    };

    await runShadowSemanticReview({ ctx, declaration });

    const contract = resolveShadowSemanticReviewRunContract(runtime, declaration);
    expect(contract).toMatchObject({
      harness: harness.name,
      model: "shadow-model",
      effort: "high",
      autonomyMode: "autonomous",
      ownerQuestionAccess: "disabled",
    });
    expect(runAgentHarness).toHaveBeenCalledOnce();
    expect(runAgentHarness.mock.calls[0]?.[1]).toMatchObject({
      model: contract.model,
      effort: contract.effort,
      autonomyMode: contract.autonomyMode,
      persistSession: false,
      enableFileCheckpointing: false,
    });
    expect(contract.maxTurns).toBeUndefined();
    expect(runAgentHarness.mock.calls[0]?.[1].maxTurns).toBeUndefined();
  });
});
