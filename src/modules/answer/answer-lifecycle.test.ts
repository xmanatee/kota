import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { ProviderRegistry } from "#core/modules/provider-registry.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { RECALL_PROVIDER_TOKEN } from "#modules/recall/recall-types.js";
import answerModule from "./index.js";

const dependencies: KotaModule[] = ["recall", "model-clients", "rendering"].map(
  (name) => ({ name }),
);

describe("answer module lifecycle", () => {
  let root: string;
  let loader: ModuleLoader;
  let providers: ProviderRegistry;
  let recall: RecallProviderImpl;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-answer-lifecycle-"));
    providers = new ProviderRegistry();
    recall = new RecallProviderImpl({ onContributorError: () => {} });
    providers.register(RECALL_PROVIDER_TOKEN, "recall", recall);
    loader = new ModuleLoader({}, false, { providerRegistry: providers });
    loader.setCwd(root);
    loader.setBus(new EventBus());
  });

  afterEach(async () => {
    await loader.unloadAll();
    rmSync(root, { recursive: true, force: true });
  });

  it("contributes answer history to recall for exactly its active lifetime", async () => {
    for (const dependency of dependencies) await loader.load(dependency);
    expect(recall.contributors()).not.toContain("answer");

    await loader.load(answerModule);
    expect(recall.contributors()).toContain("answer");

    await loader.unload("answer");
    expect(recall.contributors()).not.toContain("answer");
  });

  it("rejects activation when its declared recall service is unavailable", async () => {
    providers.unregisterOwner("recall");
    for (const dependency of dependencies) await loader.load(dependency);

    await expect(loader.load(answerModule)).rejects.toThrow(
      /recall.*not registered/i,
    );
  });
});
