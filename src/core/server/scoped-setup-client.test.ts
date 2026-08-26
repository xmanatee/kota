import { describe, expect, it } from "vitest";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import { createScopedKotaClient } from "./scoped-kota-client.js";

describe("scope-scoped setup client", () => {
  it("injects scopeId into every setup operation", async () => {
    const calls: unknown[] = [];
    const mutation = { ok: false as const, reason: "not_found" as const, message: "missing" };
    const base = {
      forScope: () => {
        throw new Error("unexpected call");
      },
      setup: {
        list: async (scope: unknown) => {
          calls.push(["setup.list", scope]);
          return {
            requirements: [],
            summary: {
              ready: 0,
              missing: 0,
              pending: 0,
              expired: 0,
              revoked: 0,
              unknown: 0,
              unavailable: 0,
            },
          };
        },
        submitForm: async (
          moduleName: string,
          requirementId: string,
          values: unknown,
          scope: unknown,
        ) => {
          calls.push(["setup.submitForm", moduleName, requirementId, values, scope]);
          return mutation;
        },
        storeSecret: async (
          moduleName: string,
          requirementId: string,
          values: unknown,
          scope: unknown,
        ) => {
          calls.push(["setup.storeSecret", moduleName, requirementId, values, scope]);
          return mutation;
        },
        start: async (moduleName: string, requirementId: string, scope: unknown) => {
          calls.push(["setup.start", moduleName, requirementId, scope]);
          return mutation;
        },
        complete: async (actionId: string, input: unknown, scope: unknown) => {
          calls.push(["setup.complete", actionId, input, scope]);
          return mutation;
        },
        refresh: async (moduleName: string, requirementId: string, scope: unknown) => {
          calls.push(["setup.refresh", moduleName, requirementId, scope]);
          return mutation;
        },
        revoke: async (moduleName: string, requirementId: string, scope: unknown) => {
          calls.push(["setup.revoke", moduleName, requirementId, scope]);
          return mutation;
        },
      },
    } as unknown as KotaClient;

    const scoped = createScopedKotaClient(base, "scope-b");
    await scoped.setup.list();
    await scoped.setup.submitForm("demo", "config", { endpoint: "https://example.test" });
    await scoped.setup.storeSecret("demo", "secret", { TOKEN: "redacted-test-value" });
    await scoped.setup.start("demo", "oauth");
    await scoped.setup.complete("demo.oauth.1", { configValues: { account: "me" } });
    await scoped.setup.refresh("demo", "oauth");
    await scoped.setup.revoke("demo", "oauth");

    expect(calls).toEqual([
      ["setup.list", { scopeId: "scope-b" }],
      ["setup.submitForm", "demo", "config", { endpoint: "https://example.test" }, { scopeId: "scope-b" }],
      ["setup.storeSecret", "demo", "secret", { TOKEN: "redacted-test-value" }, { scopeId: "scope-b" }],
      ["setup.start", "demo", "oauth", { scopeId: "scope-b" }],
      ["setup.complete", "demo.oauth.1", { configValues: { account: "me" } }, { scopeId: "scope-b" }],
      ["setup.refresh", "demo", "oauth", { scopeId: "scope-b" }],
      ["setup.revoke", "demo", "oauth", { scopeId: "scope-b" }],
    ]);
  });
});
