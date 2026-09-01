import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeStore } from "#modules/knowledge/store.js";
import { MemoryStore } from "#modules/memory/store.js";
import { RetractProviderImpl } from "./retract-provider.js";
import type { RetractScopeContext } from "./retract-types.js";

describe("RetractProviderImpl", () => {
  let root: string;
  let scope: RetractScopeContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-retract-provider-"));
    scope = {
      scopeId: "retract-test",
      scopeRoot: root,
      memory: new MemoryStore(join(root, ".kota")),
      knowledge: new KnowledgeStore(root, join(root, "global-data")),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("dispatches one uniform target/identifier request to the owning store", async () => {
    const id = scope.memory.save("remove me");
    const provider = new RetractProviderImpl();

    await expect(
      provider.retract({ target: "memory", identifier: id }, scope),
    ).resolves.toEqual({ ok: true, target: "memory", identifier: id });
    expect(scope.memory.list()).toEqual([]);
  });

  it("preserves a domain-owned not-found result", async () => {
    const provider = new RetractProviderImpl();

    await expect(
      provider.retract(
        { target: "knowledge", identifier: "missing" },
        scope,
      ),
    ).resolves.toEqual({
      ok: false,
      target: "knowledge",
      identifier: "missing",
      reason: "not_found",
    });
  });

  it("normalizes a selected store exception without cross-target retry", async () => {
    const brokenRoot = join(root, "broken");
    mkdirSync(join(brokenRoot, ".kota"), { recursive: true });
    writeFileSync(join(brokenRoot, ".kota", "data"), "not a directory");
    const brokenScope: RetractScopeContext = {
      ...scope,
      scopeRoot: brokenRoot,
      knowledge: new KnowledgeStore(brokenRoot, join(root, "broken-global")),
    };
    const provider = new RetractProviderImpl();

    await expect(
      provider.retract(
        { target: "knowledge", identifier: "missing" },
        brokenScope,
      ),
    ).resolves.toMatchObject({
      ok: false,
      reason: "retract_failed",
      target: "knowledge",
      identifier: "missing",
    });
    expect(scope.memory.list()).toEqual([]);
  });
});
