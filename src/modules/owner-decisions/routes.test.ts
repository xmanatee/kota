import { describe, expect, it } from "vitest";
import { ownerDecisionControlRoutes, ownerDecisionRoutes } from "./routes.js";

describe("owner-decisions routes", () => {
  it("declares public and daemon-control owner-decision routes", () => {
    expect(ownerDecisionRoutes().map((route) => `${route.method} ${route.path}`)).toEqual([
      "GET /api/owner-decisions",
      "GET /api/owner-decisions/:id",
      "POST /api/owner-decisions/:id/answer",
      "POST /api/owner-decisions/:id/cancel",
    ]);
    expect(ownerDecisionControlRoutes().map((route) => `${route.method} ${route.path} (${route.capabilityScope})`)).toEqual([
      "GET /owner-decisions (read)",
      "GET /owner-decisions/:id (read)",
      "POST /owner-decisions/:id/answer (control)",
      "POST /owner-decisions/:id/cancel (control)",
    ]);
  });
});
