import assert from "node:assert/strict";
import test from "node:test";
import { formatLaunchNotification } from "../src/notification-copy.mjs";

test("returns a launch notification label", () => {
  const label = formatLaunchNotification({
    productName: "Demo",
    launchAtUtc: "10:00 UTC",
    channel: "email",
  });

  assert.equal(typeof label, "string");
  assert.match(label, /Demo/);
  assert.match(label, /10:00 UTC/);
});
