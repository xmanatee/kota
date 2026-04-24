/**
 * Cross-cutting conformance: the module-owned stores implement the provider
 * protocols declared by `#core/modules/provider-registry.js`. These tests
 * instantiate real module stores so a shape drift between a provider
 * interface and its implementation fails loudly here rather than at the
 * module boundary. Lives under `src/` (not `src/core/`) because it
 * intentionally imports multiple module stores; `src/core/` may not import
 * from `#modules/*`.
 */

import { describe, expect, it } from "vitest";
import type {
  KnowledgeProvider,
  MemoryProvider,
  TaskProvider,
} from "#core/modules/provider-registry.js";

describe("provider-registry interface conformance", () => {
  it("MemoryProvider interface matches MemoryStore shape", async () => {
    const { MemoryStore } = await import("#modules/memory/store.js");
    const store = new MemoryStore("/tmp/test-provider-conformance");
    const provider: MemoryProvider = store;
    expect(typeof provider.save).toBe("function");
    expect(typeof provider.search).toBe("function");
    expect(typeof provider.list).toBe("function");
    expect(typeof provider.update).toBe("function");
    expect(typeof provider.delete).toBe("function");
    expect(typeof provider.supportsSemanticSearch).toBe("function");
    expect(typeof provider.semanticSearch).toBe("function");
    expect(typeof provider.reindex).toBe("function");
  });

  it("KnowledgeProvider interface matches KnowledgeStore shape", async () => {
    const { KnowledgeStore } = await import("#modules/knowledge/store.js");
    const store = new KnowledgeStore("/tmp/test-provider-conformance");
    const provider: KnowledgeProvider = store;
    expect(typeof provider.create).toBe("function");
    expect(typeof provider.read).toBe("function");
    expect(typeof provider.update).toBe("function");
    expect(typeof provider.delete).toBe("function");
    expect(typeof provider.search).toBe("function");
    expect(typeof provider.list).toBe("function");
    expect(typeof provider.count).toBe("function");
    expect(typeof provider.supportsSemanticSearch).toBe("function");
    expect(typeof provider.semanticSearch).toBe("function");
    expect(typeof provider.reindex).toBe("function");
  });

  it("TaskProvider interface matches TaskStore shape", async () => {
    const { TaskStore } = await import("#core/daemon/task-store.js");
    const store = new TaskStore(undefined, null);
    const provider: TaskProvider = store;
    expect(typeof provider.add).toBe("function");
    expect(typeof provider.update).toBe("function");
    expect(typeof provider.list).toBe("function");
    expect(typeof provider.active).toBe("function");
    expect(typeof provider.get).toBe("function");
    expect(typeof provider.clear).toBe("function");
    expect(typeof provider.archiveCompleted).toBe("function");
    expect(typeof provider.getActiveSummary).toBe("function");
    expect(typeof provider.isEmpty).toBe("function");
    expect(typeof provider.count).toBe("function");
  });

  // HistoryProvider conformance is enforced structurally: the history
  // module's onLoad calls `ctx.registerProvider("history", getHistory())`
  // with a typed HistoryProvider target, so any shape mismatch fails at
  // typecheck. The neutral core guard blocks `#modules/history` imports
  // under `src/core/`, so there is no in-core runtime check.
});
