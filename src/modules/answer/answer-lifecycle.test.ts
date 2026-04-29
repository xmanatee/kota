/**
 * Lifecycle test for the answer module's recall-contributor registration.
 *
 * Verifies the public registration seam: the answer module reads the live
 * `RecallProvider` through `ctx.getProvider(RECALL_PROVIDER_TOKEN)`, calls
 * `register(...)` from its `onLoad`, and calls `unregister("answer")` from
 * its `onUnload`. The recall module is exercised through a real
 * `RecallProviderImpl` rather than a stub so the test pins the same
 * register/unregister API any other contributing module sees.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initProviderRegistry,
  resetProviderRegistry,
} from "#core/modules/provider-registry.js";
import { ModuleTestHarness } from "#core/modules/testing/index.js";
import { RecallProviderImpl } from "#modules/recall/recall-provider.js";
import { RECALL_PROVIDER_TOKEN } from "#modules/recall/recall-types.js";
import answerModule from "./index.js";

let projectRoot: string;
let recallProvider: RecallProviderImpl;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "kota-answer-lifecycle-"));
  resetProviderRegistry();
  const reg = initProviderRegistry();
  recallProvider = new RecallProviderImpl({ onContributorError: () => {} });
  reg.register(RECALL_PROVIDER_TOKEN, "recall", recallProvider);
});

afterEach(() => {
  resetProviderRegistry();
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("answer module lifecycle — recall contributor registration", () => {
  it("registers an `answer` contributor on the live RecallProvider during onLoad", async () => {
    expect(recallProvider.contributors()).toEqual([]);

    const harness = await ModuleTestHarness.create(answerModule, {
      cwd: projectRoot,
    });

    expect(recallProvider.contributors()).toContain("answer");

    await harness.teardown();
  });

  it("unregisters the `answer` contributor on onUnload", async () => {
    const harness = await ModuleTestHarness.create(answerModule, {
      cwd: projectRoot,
    });
    expect(recallProvider.contributors()).toContain("answer");

    await harness.teardown();

    // `recallProvider` is the same instance we registered before load; the
    // module's `onUnload` calls `unregister("answer")` on it directly, so
    // the contributor list should no longer carry "answer" after teardown.
    expect(recallProvider.contributors()).not.toContain("answer");
  });

  it("throws cleanly when the recall provider is not registered before answer", async () => {
    resetProviderRegistry();
    initProviderRegistry();
    const harness = new ModuleTestHarness(answerModule, { cwd: projectRoot });
    await expect(harness.load()).rejects.toThrow(
      /recall.*not registered/i,
    );
  });
});
