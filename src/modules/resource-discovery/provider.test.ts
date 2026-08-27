import { describe, expect, it } from "vitest";
import type { ConfiguredMcpServerResource } from "./catalog.js";
import { ResourceDiscoveryProviderImpl } from "./provider.js";
import {
  moduleSummary,
  notificationManifest,
  snapshot,
} from "./provider-test-support.js";
import { renderResourceDiscoveryHitsPlain } from "./render.js";

describe("ResourceDiscoveryProviderImpl", () => {
  it("matches and deterministically ranks capability metadata", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() => snapshot());
    const first = await provider.discover("send slack approval", { limit: 5 });
    const second = await provider.discover("send slack approval", { limit: 5 });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.hits[0]).toMatchObject({
      kind: "tool",
      name: "slack_send",
      ownerModule: "slack-channel",
    });
    expect(first.hits[0].why.join(" ")).toContain("description");
  });

  it("surfaces setup blockers on resources linked to unsatisfied requirements", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() => snapshot());
    const result = await provider.discover("slack approval", {
      kinds: ["tool"],
      limit: 1,
    });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0].readiness.status).toBe("setup_blocked");
    expect(JSON.stringify(result.hits[0])).not.toContain("xoxb-secret");
    expect(JSON.stringify(result.hits[0])).not.toContain("SLACK_APP_TOKEN_VALUE");
  });

  it("keeps unavailable modules visible with an explicit reason", async () => {
    const broken = moduleSummary({
      name: "broken-slack",
      toolNames: [],
      channelNames: [],
      loadError: "failed to load test module",
      manifest: undefined,
    });
    const provider = new ResourceDiscoveryProviderImpl(() =>
      snapshot({ summaries: [broken], tools: [], toolEffects: new Map() })
    );
    const result = await provider.discover("broken slack", { limit: 3 });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0]).toMatchObject({
      kind: "module",
      name: "broken-slack",
      readiness: {
        status: "unavailable",
        reason: "module_load_failed",
      },
    });
  });

  it("renders mutating tool risk and effect metadata", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() => snapshot());
    const result = await provider.discover("slack send", { kinds: ["tool"] });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0].risk).toMatchObject({
      risk: "moderate",
      effect: { kind: "write", scope: "external-network" },
    });
    const rendered = renderResourceDiscoveryHitsPlain(result.hits);
    expect(rendered).toContain("risk: moderate write/external-network");
  });

  it("renders manifest effect metadata for mutating channel resources", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() => snapshot());
    const result = await provider.discover("slack channel delivery", {
      kinds: ["channel"],
    });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0]).toMatchObject({
      kind: "channel",
      name: "slack-channel",
      risk: {
        risk: "safe",
        effect: { kind: "write", scope: "operator-surface" },
      },
      metadata: {
        effectIds: "slack-channel.message-delivery",
        effectSources: "channel",
        effectCategories: "notification,owner-visible",
        effectKinds: "write",
        effectScopes: "operator-surface",
        simulationBlocked: true,
        primaryEffectId: "slack-channel.message-delivery",
        primaryEffectRisk: "safe",
      },
    });
    const rendered = renderResourceDiscoveryHitsPlain(result.hits);
    expect(rendered).toContain("risk: safe write/operator-surface");
    expect(rendered).not.toContain("risk: none");
  });

  it("renders manifest effect metadata for mutating module resources", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() =>
      snapshot({
        summaries: [
          moduleSummary({
            name: "slack",
            description: "Slack Incoming Webhook notification channel for KOTA workflow events.",
            dependencies: ["notification"],
            toolNames: [],
            channelNames: [],
            manifest: notificationManifest(),
          }),
        ],
        tools: [],
        toolEffects: new Map(),
        knowledgeEntries: [],
      })
    );
    const result = await provider.discover("workflow notifications slack", {
      kinds: ["module"],
    });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0]).toMatchObject({
      kind: "module",
      name: "slack",
      risk: {
        risk: "safe",
        effect: { kind: "write", scope: "operator-surface" },
      },
      metadata: {
        effectIds: "slack.webhook-delivery",
        effectSources: "notification",
        effectCategories: "notification,owner-visible",
        effectKinds: "write",
        effectScopes: "operator-surface",
        simulationBlocked: true,
        primaryEffectId: "slack.webhook-delivery",
        primaryEffectRisk: "safe",
      },
    });
    const rendered = renderResourceDiscoveryHitsPlain(result.hits);
    expect(rendered).toContain("risk: safe write/operator-surface");
    expect(rendered).not.toContain("risk: none");
  });

  it("includes MCP config metadata without exposing connector values", async () => {
    const mcpServer: ConfiguredMcpServerResource = {
      name: "payments",
      transport: "http",
      configPath: ".kota/mcp.json#mcpServers.payments",
      fields: ["authorization", "headers", "url"],
    };
    const provider = new ResourceDiscoveryProviderImpl(() =>
      snapshot({ mcpServers: [mcpServer] })
    );
    const result = await provider.discover("payments mcp server", {
      kinds: ["mcp-server"],
    });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0]).toMatchObject({
      kind: "mcp-server",
      name: "payments",
      readiness: { status: "read_only" },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("authorization,headers,url");
    expect(serialized).not.toContain("https://private.example");
    expect(serialized).not.toContain("Bearer");
  });

  it("discovers imported skills from the skill-ops skill list", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() =>
      snapshot({
        summaries: [],
        tools: [],
        toolEffects: new Map(),
        skillSummaries: [
          {
            name: "typescript-review",
            source: "imported",
            sourceType: "imported",
            status: "resolvable",
            activation: "explicit",
            description: "Review TypeScript patches and identify risky changes.",
            promptPath: ".kota/skills/typescript-review/SKILL.md",
            provenance: "github:owner/skills -> typescript-review/SKILL.md",
            resourceSummary: "1 resource; 0 skipped",
          },
        ],
        knowledgeEntries: [],
      })
    );
    const result = await provider.discover("typescript review imported skill", {
      kinds: ["skill"],
    });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits[0]).toMatchObject({
      kind: "skill",
      name: "typescript-review",
      ownerModule: "skill-ops",
      readiness: { status: "read_only" },
      metadata: {
        source: "imported",
        sourceType: "imported",
        activation: "explicit",
        status: "resolvable",
        resourceSummary: "1 resource; 0 skipped",
      },
    });
  });

  it("discovers recall-backed memory, history, tasks, and answer-history hits", async () => {
    const provider = new ResourceDiscoveryProviderImpl(() =>
      snapshot({
        summaries: [],
        tools: [],
        toolEffects: new Map(),
        knowledgeEntries: [],
        recallHits: [
          {
            source: "memory",
            score: 0.95,
            id: "mem-1",
            preview: "Deployment checklist includes rollback and owner notice.",
            created: "2026-06-24T00:00:00.000Z",
          },
          {
            source: "history",
            score: 0.9,
            id: "hist-1",
            title: "Deployment checklist planning session",
            cwd: "/repo",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
          {
            source: "tasks",
            score: 0.88,
            id: "task-1",
            title: "Finish deployment checklist",
            state: "done",
            priority: "p1",
          },
          {
            source: "answer",
            score: 0.8,
            id: "answer-1",
            query: "How should I run the deployment checklist?",
            preview: "Run tests, notify owner, and keep rollback ready.",
            citationCount: 2,
            createdAt: "2026-06-24T00:00:00.000Z",
            result: { ok: true },
          },
        ],
      })
    );
    const result = await provider.discover("deployment checklist", {
      kinds: ["recall-hit"],
      limit: 10,
    });
    if (!result.ok) throw new Error("expected ok result");
    expect(result.hits.map((hit) => hit.metadata.source).sort()).toEqual([
      "answer",
      "history",
      "memory",
      "tasks",
    ]);
    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "recall-hit",
          ownerModule: "recall",
          readiness: { status: "read_only", message: "Recall hits are read-only from discovery." },
          accessHint: expect.stringContaining("kota recall --source memory"),
        }),
        expect.objectContaining({
          kind: "recall-hit",
          metadata: expect.objectContaining({
            source: "answer",
            result: "ok",
            citationCount: 2,
          }),
        }),
      ]),
    );
  });
});
