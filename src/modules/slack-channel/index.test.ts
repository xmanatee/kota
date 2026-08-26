import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import { resolveModuleChannels } from "#core/modules/module-types.js";

vi.mock("./bot.js", () => {
  const SlackBot = vi.fn(function (this: Record<string, unknown>) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn();
    this.postApproval = vi.fn().mockResolvedValue(undefined);
    this.listScopeSessionIds = vi.fn().mockReturnValue([]);
    this.closeScopeSessions = vi.fn();
  });
  return { SlackBot };
});

import { SlackBot } from "./bot.js";
import slackChannelModule from "./index.js";
import { makeSlackChannelModuleTestContext as makeStubCtx } from "./index-test-support.js";

const MockedSlackBot = vi.mocked(SlackBot);

describe("slackChannelModule metadata", () => {
  it("has correct name and version", () => {
    expect(slackChannelModule.name).toBe("slack-channel");
    expect(slackChannelModule.version).toBe("1.0.0");
  });

  it("description mentions Slack", () => {
    expect(slackChannelModule.description).toContain("Slack");
  });

  it("declares setup requirements for Socket Mode token references and secrets", () => {
    const setupRequirements = slackChannelModule.setupRequirements;
    if (!setupRequirements || typeof setupRequirements === "function") {
      throw new Error("expected static setup requirements");
    }
    const configRequirement = setupRequirements.find(
      (requirement) => requirement.id === "socket-mode-config",
    );
    if (!configRequirement || configRequirement.kind !== "config") {
      throw new Error("expected socket-mode-config setup requirement");
    }
    expect(configRequirement.setup.fields.map((field) => ({
      id: field.id,
      valueKind: field.valueKind,
      configPath: field.configPath,
    }))).toEqual([
      {
        id: "bot-token-ref",
        valueKind: "secret-reference",
        configPath: "modules.slack-channel.botToken",
      },
      {
        id: "app-token-ref",
        valueKind: "secret-reference",
        configPath: "modules.slack-channel.appToken",
      },
      {
        id: "workspace-id",
        valueKind: undefined,
        configPath: "modules.slack-channel.workspaceId",
      },
      {
        id: "notify-channel",
        valueKind: undefined,
        configPath: "modules.slack-channel.notifyChannel",
      },
    ]);

    const credentialsRequirement = setupRequirements.find(
      (requirement) => requirement.id === "socket-mode-credentials",
    );
    if (!credentialsRequirement || credentialsRequirement.kind !== "secret") {
      throw new Error("expected socket-mode-credentials setup requirement");
    }
    expect(credentialsRequirement.secretRefs).toEqual([
      { name: "SLACK_BOT_TOKEN", scope: "scope" },
      { name: "SLACK_APP_TOKEN", scope: "scope" },
    ]);
  });

  it("contributes a slack-channel channel", async () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    const channels = await resolveModuleChannels(slackChannelModule, ctx);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe("slack-channel");
    expect(channels[0].description).toBeTruthy();
  });

  it("does not register tools, routes, or commands", () => {
    expect(slackChannelModule.tools).toBeUndefined();
    expect(slackChannelModule.routes).toBeUndefined();
    expect(slackChannelModule.commands).toBeUndefined();
  });});

describe("slackChannelModule onLoad", () => {
  beforeEach(() => {
    MockedSlackBot.mockClear();
  });

  it("warns when config is missing", () => {
    const ctx = makeStubCtx(undefined, undefined);
    slackChannelModule.onLoad!(ctx);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("botToken and appToken are required"),
    );
  });

  it("warns when only botToken is present (no appToken)", () => {
    const ctx = makeStubCtx(undefined, { botToken: "xoxb-test" });
    slackChannelModule.onLoad!(ctx);
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("does not construct SlackBot at load time", () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);
    expect(MockedSlackBot).not.toHaveBeenCalled();
  });

  it("warns that interactive input is default-denied without admission config", () => {
    const ctx = makeStubCtx(undefined, {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    });
    slackChannelModule.onLoad!(ctx);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("interactive input is disabled"),
    );
  });

  it("throws loudly when neither channel nor serve autonomy is configured", () => {
    const ctx = makeStubCtx(
      undefined,
      { botToken: "xoxb-test", appToken: "xapp-test" },
      {} as ModuleRuntimeContext["config"],
    );
    expect(() => slackChannelModule.onLoad!(ctx)).toThrow(
      /slack-channel: autonomy mode is not configured/,
    );
  });});
