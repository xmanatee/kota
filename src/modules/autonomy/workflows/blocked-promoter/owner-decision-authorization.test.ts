import { describe, expect, it } from "vitest";
import { answerApprovesPromotion } from "./owner-decision-authorization.js";

describe("owner-decision promotion authorization", () => {
  it("accepts the explicit displayed unblock token", () => {
    expect(
      answerApprovesPromotion(" unblock ", ["keep-blocked", "unblock"]),
    ).toBe(true);
  });

  it.each(["yes", "approve", "promote"])(
    "does not grant promotion authority to ambiguous '%s'",
    (answer) => {
      expect(
        answerApprovesPromotion(answer, ["keep-blocked", "unblock"]),
      ).toBe(false);
    },
  );

  it("rejects unblock when that token was not displayed", () => {
    expect(answerApprovesPromotion("unblock", ["keep-blocked"])).toBe(false);
  });
});
