import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationHistory } from "#modules/history/history.js";
import { FakeEmbeddingProvider } from "#modules/semantic-index/test-support.js";
import { SemanticHistoryStore } from "./semantic-store.js";

const roots: string[] = [];

function createStore(): SemanticHistoryStore {
  const root = join(tmpdir(), `kota-history-mapping-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return new SemanticHistoryStore({
    base: new ConversationHistory(root),
    provider: new FakeEmbeddingProvider(),
    onBackgroundError: () => {},
  });
}

function saveConversation(
  store: SemanticHistoryStore,
  content: string,
  cwd: string,
): string {
  const id = store.create("model", cwd, "user");
  store.save(id, [{ role: "user", content }], 0, 0);
  return id;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SemanticHistoryStore adapter mapping", () => {
  it("indexes conversation message text, not only record metadata", async () => {
    const store = createStore();
    const expected = saveConversation(store, "monitor spend and cost anomaly", "/repo");
    saveConversation(store, "bread baking recipe", "/repo");
    await store.flush();

    const results = await store.semanticSearch("expense metrics", 1);
    expect(results.map((entry) => entry.id)).toEqual([expected]);
  });

  it("maps cwd and source filters before manager ranking", async () => {
    const store = createStore();
    const expected = saveConversation(store, "monitor spend", "/here");
    saveConversation(store, "monitor spend", "/elsewhere");
    await store.flush();

    const results = await store.semanticSearch("cost", 5, {
      cwd: "/here",
      source: "user",
    });
    expect(results.map((entry) => entry.id)).toEqual([expected]);
  });
});
