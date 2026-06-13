import { describe, expect, it } from "vitest";
import type { KotaModule } from "#core/modules/module-types.js";
import browserModule from "#modules/browser/index.js";
import emailModule from "#modules/email/index.js";
import executionModule from "#modules/execution/index.js";
import githubModule from "#modules/github/index.js";
import googleWorkspaceModule from "#modules/google-workspace/index.js";
import linearModule from "#modules/linear/index.js";
import modelClientsModule from "#modules/model-clients/index.js";
import pushNotificationModule from "#modules/push-notification/index.js";
import retractModule from "#modules/retract/index.js";
import slackModule from "#modules/slack/index.js";
import slackChannelModule from "#modules/slack-channel/index.js";
import systemModule from "#modules/system/index.js";
import telegramModule from "#modules/telegram/index.js";
import webAccessModule from "#modules/web-access/index.js";

const REQUIRED_MANIFEST_MODULES: KotaModule[] = [
  telegramModule,
  googleWorkspaceModule,
  slackChannelModule,
  browserModule,
  webAccessModule,
  modelClientsModule,
  executionModule,
  systemModule,
  githubModule,
  linearModule,
  retractModule,
  emailModule,
  slackModule,
  pushNotificationModule,
];

describe("shipped module capability/effect manifest coverage", () => {
  for (const mod of REQUIRED_MANIFEST_MODULES) {
    it(`${mod.name} declares capability, data, and simulation coverage`, () => {
      expect(mod.manifest).toBeDefined();
      if (!mod.manifest || typeof mod.manifest === "function") {
        throw new Error(`expected static manifest for ${mod.name}`);
      }
      expect(mod.manifest.schemaVersion).toBe(1);
      expect(mod.manifest.capabilities.length).toBeGreaterThan(0);
      expect(mod.manifest.dataClasses.length).toBeGreaterThan(0);
      expect(mod.manifest.simulation.blockedReasons.length).toBeGreaterThan(0);
    });
  }

  it("manifest declarations do not carry secret values", () => {
    const serialized = JSON.stringify(
      REQUIRED_MANIFEST_MODULES.map((mod) => mod.manifest),
    );
    expect(serialized).not.toMatch(/xoxb-|xapp-|ya29|sk-live|sk-proj|secret-value/i);
    expect(serialized).toContain("mask-secret");
  });
});
