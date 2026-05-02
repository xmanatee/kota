/**
 * Compile-time guard for the contribution-vs-runtime context split.
 *
 * The runtime hands every module hook the same physical context object, but
 * the typed protocol exposes fewer capabilities to non-`onLoad` hooks. This
 * test fails at typecheck time if a contribution hook (`tools`, `commands`,
 * `routes`, `controlRoutes`, `localClient`) regains the lifecycle-only
 * `register*` powers, or if `onLoad`'s runtime context loses them.
 *
 * Runs at compile time only — every assertion is a `// @ts-expect-error`.
 * If the directive becomes unused (i.e. the call now typechecks), the test
 * file fails to compile, telling us the boundary leaked.
 */

import { describe, it } from "vitest";
import type {
  KotaModule,
  ModuleContext,
  ModuleRuntimeContext,
  RouteRegistration,
  ToolDef,
} from "./module-types.js";
import { defineProviderToken } from "./provider-token.js";

describe("module context capability boundary", () => {
  it("contribution hooks never see registration-only members", () => {
    // Reading these in a contribution-typed callback must fail typecheck.
    const tools = (ctx: ModuleContext): ToolDef[] => {
      // @ts-expect-error registerProvider is runtime-only, not in ModuleContext
      ctx.registerProvider;
      // @ts-expect-error registerMiddleware is runtime-only
      ctx.registerMiddleware;
      // @ts-expect-error registerGroup is runtime-only
      ctx.registerGroup;
      // @ts-expect-error registerCleanupHook is runtime-only
      ctx.registerCleanupHook;
      // @ts-expect-error registerDynamicStateProvider is runtime-only
      ctx.registerDynamicStateProvider;
      // @ts-expect-error registerPreSendHook is runtime-only
      ctx.registerPreSendHook;
      // @ts-expect-error registerHarnessHook is runtime-only
      ctx.registerHarnessHook;
      return [];
    };

    const routes = (ctx: ModuleContext): RouteRegistration[] => {
      // @ts-expect-error registerProvider is runtime-only
      ctx.registerProvider;
      return [];
    };

    const localClient = (ctx: ModuleContext) => {
      // @ts-expect-error registerProvider is runtime-only
      ctx.registerProvider;
      // @ts-expect-error registerHarnessHook is runtime-only
      ctx.registerHarnessHook;
      return {};
    };

    // Read-side capabilities the contribution hooks legitimately need stay
    // available — these reads must typecheck cleanly.
    const okReads = (ctx: ModuleContext) => {
      ctx.cwd;
      ctx.config;
      ctx.log.info("");
      ctx.getModuleConfig();
      ctx.getProvider(defineProviderToken<unknown>("ctx-boundary"));
      ctx.callTool;
      ctx.events.emit;
      ctx.createSession;
      ctx.client;
    };

    void tools;
    void routes;
    void localClient;
    void okReads;
  });

  it("runtime context exposes registration-only members", () => {
    const onLoad = (ctx: ModuleRuntimeContext) => {
      ctx.registerProvider;
      ctx.registerMiddleware;
      ctx.registerGroup;
      ctx.registerCleanupHook;
      ctx.registerDynamicStateProvider;
      ctx.registerPreSendHook;
      ctx.registerHarnessHook;
      // And every read-side capability stays available.
      ctx.cwd;
      ctx.config;
      ctx.log.info("");
      ctx.getProvider;
      ctx.callTool;
      ctx.events.emit;
      ctx.client;
    };
    void onLoad;
  });

  it("KotaModule.onLoad receives ModuleRuntimeContext", () => {
    // If a future change types `onLoad` back to `ModuleContext`, this
    // assignment fails because `register*` calls below would not typecheck.
    const mod: KotaModule = {
      name: "ctx-boundary-fixture",
      onLoad: (ctx) => {
        ctx.registerProvider;
        ctx.registerHarnessHook;
      },
      tools: (ctx) => {
        // @ts-expect-error tools factory receives ModuleContext, not runtime
        ctx.registerProvider;
        return [];
      },
      commands: (ctx) => {
        // @ts-expect-error commands factory receives ModuleContext
        ctx.registerHarnessHook;
        return [];
      },
      routes: (ctx) => {
        // @ts-expect-error routes factory receives ModuleContext
        ctx.registerProvider;
        return [];
      },
      controlRoutes: (ctx) => {
        // @ts-expect-error controlRoutes factory receives ModuleContext
        ctx.registerCleanupHook;
        return [];
      },
      localClient: (ctx) => {
        // @ts-expect-error localClient factory receives ModuleContext
        ctx.registerMiddleware;
        return {};
      },
    };
    void mod;
  });
});
