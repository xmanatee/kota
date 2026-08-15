import { describe, expect, it } from "vitest";
import { admitSlackInteraction, admitSlackMessage } from "./admission.js";

const policy = {
  workspaceId: "T-EXPECTED",
  allowedUserIds: ["U-OWNER"],
};

describe("Slack interactive admission", () => {
  it("admits only allowlisted direct messages from the configured workspace", () => {
    expect(admitSlackMessage(
      policy,
      {
        type: "message",
        user: "U-OWNER",
        channel: "D-OWNER",
        channel_type: "im",
      },
      { team_id: "T-EXPECTED", event: { type: "message" } },
    )).toEqual({ admitted: true });

    expect(admitSlackMessage(
      policy,
      {
        type: "message",
        user: "U-INTRUDER",
        channel: "D-INTRUDER",
        channel_type: "im",
      },
      { team_id: "T-EXPECTED", event: { type: "message" } },
    )).toEqual({ admitted: false, reason: "user-not-allowed" });

    expect(admitSlackMessage(
      policy,
      {
        type: "message",
        user: "U-OWNER",
        channel: "D-OWNER",
        channel_type: "im",
      },
      { team_id: "T-OTHER", event: { type: "message" } },
    )).toEqual({ admitted: false, reason: "workspace-mismatch" });

    expect(admitSlackMessage(
      policy,
      {
        type: "message",
        user: "U-OWNER",
        channel: "C-PUBLIC",
        channel_type: "channel",
      },
      { team_id: "T-EXPECTED", event: { type: "message" } },
    )).toEqual({ admitted: false, reason: "message-not-direct" });
  });

  it("default-denies messages when the workspace or allowlist is absent", () => {
    expect(admitSlackMessage(
      { allowedUserIds: ["U-OWNER"] },
      {
        type: "message",
        user: "U-OWNER",
        channel: "D-OWNER",
        channel_type: "im",
      },
      { team_id: "T-EXPECTED", event: { type: "message" } },
    )).toEqual({ admitted: false, reason: "workspace-not-configured" });

    expect(admitSlackMessage(
      { workspaceId: "T-EXPECTED", allowedUserIds: [] },
      {
        type: "message",
        user: "U-OWNER",
        channel: "D-OWNER",
        channel_type: "im",
      },
      { team_id: "T-EXPECTED", event: { type: "message" } },
    )).toEqual({ admitted: false, reason: "user-not-allowed" });
  });

  it("applies the same workspace and user admission to callbacks", () => {
    const interaction = {
      type: "block_actions" as const,
      team: { id: "T-EXPECTED" },
      actions: [{ action_id: "reject:approval", value: "reject:approval" }],
      user: { id: "U-OWNER", name: "Owner" },
      channel: { id: "C-NOTIFY" },
      message: { ts: "123.456" },
    };

    expect(admitSlackInteraction(policy, interaction)).toEqual({ admitted: true });
    expect(admitSlackInteraction(policy, {
      ...interaction,
      user: { id: "U-INTRUDER", name: "Intruder" },
    })).toEqual({ admitted: false, reason: "user-not-allowed" });
    expect(admitSlackInteraction(policy, {
      ...interaction,
      team: { id: "T-OTHER" },
    })).toEqual({ admitted: false, reason: "workspace-mismatch" });
  });
});
