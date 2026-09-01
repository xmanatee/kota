import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { CaptureProviderImpl } from "./capture-provider.js";
import type { CaptureScopeContext } from "./capture-types.js";

describe("CaptureProviderImpl", () => {
  let root: string;
  let scope: CaptureScopeContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-capture-provider-"));
    scope = {
      scopeId: "capture-test",
      scopeRoot: root,
      memory: new MemoryStore(join(root, ".kota")),
      knowledge: new KnowledgeStore(root, join(root, "global-data")),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("uses an explicit target without classification", async () => {
    const classify = vi.fn();
    const provider = new CaptureProviderImpl({ classifier: { classify } });

    const result = await provider.capture(
      "  remember this  ",
      { target: "memory" },
      scope,
    );

    expect(result).toMatchObject({ ok: true, target: "memory" });
    expect(classify).not.toHaveBeenCalled();
    expect(scope.memory.list()[0]?.content).toBe("remember this");
  });

  it("classifies an unpinned write against the canonical target set", async () => {
    const provider = new CaptureProviderImpl({
      classifier: {
        classify: vi.fn().mockResolvedValue({
          kind: "confident",
          target: "knowledge",
        }),
      },
    });

    const result = await provider.capture("fact", undefined, scope);

    expect(result).toMatchObject({ ok: true, target: "knowledge" });
    expect(scope.knowledge.list()[0]?.content).toBe("fact");
  });

  it("returns ambiguity without persisting when classification abstains", async () => {
    const provider = new CaptureProviderImpl({
      classifier: {
        classify: vi.fn().mockResolvedValue({ kind: "ambiguous" }),
      },
    });

    await expect(provider.capture("unclear", undefined, scope)).resolves.toEqual({
      ok: false,
      reason: "ambiguous",
      suggestions: ["memory", "knowledge", "tasks", "inbox"],
    });
    expect(scope.memory.list()).toEqual([]);
    expect(scope.knowledge.list()).toEqual([]);
  });

  it("normalizes a selected store exception without retrying another target", async () => {
    const provider = new CaptureProviderImpl();
    const noScopeKnowledge: CaptureScopeContext = {
      ...scope,
      knowledge: new KnowledgeStore(undefined, join(root, "global-only")),
    };

    await expect(
      provider.capture("note", { target: "knowledge" }, noScopeKnowledge),
    ).resolves.toMatchObject({
      ok: false,
      reason: "write_failed",
      target: "knowledge",
      message: "No scope directory configured",
    });
    expect(scope.memory.list()).toEqual([]);
  });
});
