import { describe, expect, it } from "vitest";
import { RemoteTaskIdentity } from "./remote-task-identity.js";

describe("RemoteTaskIdentity", () => {
  it("projects the same remote identity across provider reloads", () => {
    const first = new RemoteTaskIdentity("Linear");
    const restarted = new RemoteTaskIdentity("Linear");

    expect(first.localId("6f938cc8-d329-4d46-9bd5-ec3e38075262")).toBe(
      restarted.localId("6f938cc8-d329-4d46-9bd5-ec3e38075262"),
    );
  });

  it("preserves native positive numeric identities", () => {
    const identities = new RemoteTaskIdentity("Jira");

    expect(identities.localId("10042")).toBe(10042);
    expect(identities.remoteId(10042)).toBe("10042");
  });
});
