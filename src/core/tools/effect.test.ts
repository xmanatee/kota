import { afterEach, describe, expect, it } from "vitest";
import type { KotaTool } from "#core/agent-harness/message-protocol.js";
import type { ToolDef } from "#core/modules/module-types.js";
import {
  daemonWriteEffect,
  legacyEffect,
  localWriteEffect,
  mcpAnnotationsFromEffect,
  networkDestructiveEffect,
  networkReadEffect,
  operatorSurfaceEffect,
  readOnlyLocalEffect,
  riskFromEffect,
  type ToolEffect,
} from "./effect.js";
import { getToolMcpAnnotations } from "./guardrails-classify.js";
import { clearCustomTools, registerTool } from "./index.js";

describe("riskFromEffect", () => {
  it("maps read + !openWorld to safe", () => {
    expect(riskFromEffect(readOnlyLocalEffect())).toBe("safe");
  });

  it("maps read + openWorld to moderate (network exfiltration risk)", () => {
    expect(riskFromEffect(networkReadEffect())).toBe("moderate");
  });

  it("maps local-fs writes to moderate", () => {
    expect(riskFromEffect(localWriteEffect())).toBe("moderate");
  });

  it("maps coordination-surface writes (session, operator-surface, daemon-state) to safe", () => {
    expect(riskFromEffect(daemonWriteEffect())).toBe("safe");
    expect(riskFromEffect(operatorSurfaceEffect())).toBe("safe");
    expect(
      riskFromEffect({
        kind: "write",
        scope: "session",
        idempotent: false,
        openWorld: false,
      }),
    ).toBe("safe");
  });

  it("maps destructive to dangerous regardless of scope", () => {
    expect(riskFromEffect(networkDestructiveEffect())).toBe("dangerous");
    expect(
      riskFromEffect({
        kind: "destructive",
        scope: "local-fs",
        idempotent: false,
        openWorld: false,
      }),
    ).toBe("dangerous");
  });
});

describe("mcpAnnotationsFromEffect", () => {
  it("emits readOnlyHint and idempotentHint for read effects", () => {
    expect(mcpAnnotationsFromEffect(readOnlyLocalEffect())).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("emits openWorldHint for network reads", () => {
    expect(mcpAnnotationsFromEffect(networkReadEffect())).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("emits destructiveHint and openWorldHint for network destructive effects", () => {
    expect(mcpAnnotationsFromEffect(networkDestructiveEffect())).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("emits a write tier for local writes (not destructive)", () => {
    expect(mcpAnnotationsFromEffect(localWriteEffect())).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});

describe("legacyEffect", () => {
  it("maps safe + discovery to a read effect", () => {
    const eff = legacyEffect({ risk: "safe", kind: "discovery" });
    expect(eff.kind).toBe("read");
    expect(eff.openWorld).toBe(false);
  });

  it("maps safe + discovery + openWorld:true to a network read", () => {
    const eff = legacyEffect({ risk: "safe", kind: "discovery", openWorld: true });
    expect(eff.kind).toBe("read");
    expect(eff.scope).toBe("external-network");
    expect(eff.openWorld).toBe(true);
  });

  it("maps moderate to a write effect", () => {
    const eff = legacyEffect({ risk: "moderate", kind: "action" });
    expect(eff.kind).toBe("write");
  });

  it("maps dangerous to a destructive effect with openWorld", () => {
    const eff = legacyEffect({ risk: "dangerous", kind: "action" });
    expect(eff.kind).toBe("destructive");
    expect(eff.openWorld).toBe(true);
  });
});

describe("getToolMcpAnnotations (effect-derived)", () => {
  afterEach(() => clearCustomTools());

  it("returns undefined for unknown tools", () => {
    expect(getToolMcpAnnotations("not_a_real_tool_xyz")).toBeUndefined();
  });

  it("derives read-only hint from a registered read effect", () => {
    registerTool(
      { name: "ann_read", description: "read", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
      "ann-mod",
      { effect: readOnlyLocalEffect() },
    );
    expect(getToolMcpAnnotations("ann_read")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("derives destructive + openWorld hint from a registered destructive effect", () => {
    registerTool(
      { name: "ann_destroy", description: "destroy", input_schema: { type: "object", properties: {} } },
      async () => ({ content: "ok" }),
      "ann-mod",
      { effect: networkDestructiveEffect() },
    );
    const ann = getToolMcpAnnotations("ann_destroy");
    expect(ann?.destructiveHint).toBe(true);
    expect(ann?.openWorldHint).toBe(true);
    expect(ann?.readOnlyHint).toBe(false);
  });
});

describe("ToolDef requires an effect at compile time", () => {
  it("a ToolDef literal without an effect field fails to typecheck", () => {
    const tool: KotaTool = {
      name: "no_effect",
      description: "x",
      input_schema: { type: "object", properties: {} },
    };

    // If a future change makes `effect` optional on `ToolDef`, the
    // `@ts-expect-error` directive below becomes unused and the test file
    // fails to typecheck — flagging the regression. The runtime guard in
    // `module-loader.test.ts` ("rejects a tool missing effect metadata")
    // covers the same invariant at load time.
    // @ts-expect-error effect is a required field on ToolDef
    const def: ToolDef = {
      tool,
      runner: async () => ({ content: "" }),
    };
    expect(def.tool.name).toBe("no_effect");
  });

  it("riskFromEffect returns a defined tier for every effect kind/scope combination", () => {
    const kinds: ReadonlyArray<ToolEffect["kind"]> = ["read", "write", "destructive"];
    const scopes: ReadonlyArray<ToolEffect["scope"]> = [
      "session",
      "local-fs",
      "daemon-state",
      "external-network",
      "operator-surface",
    ];
    for (const kind of kinds) {
      for (const scope of scopes) {
        for (const openWorld of [false, true]) {
          for (const idempotent of [false, true]) {
            const effect: ToolEffect = { kind, scope, idempotent, openWorld };
            const risk = riskFromEffect(effect);
            expect(["safe", "moderate", "dangerous"]).toContain(risk);
          }
        }
      }
    }
  });
});
