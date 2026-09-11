import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { executeDelegateToolBlocks } from "./delegate-turn-tools.js";
import { localWriteEffect, networkWriteEffect } from "./effect.js";
import { registerTool } from "./index.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

let root: string;
const disposers: Array<() => void> = [];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "owned-tool-targets-"));
  mkdirSync(join(root, "allowed"));
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  rmSync(root, { recursive: true, force: true });
});

function options(paths: string[], gate: "agent" | "scope" = "agent"): ToolCallExecutionOptions {
  return {
    resultLimit: 50_000, verbose: false, autonomyMode: "autonomous", cwd: root, scopeRoot: root,
    ...(gate === "agent" ? { agentWriteScope: paths } : { scopePolicy: resolveScopePolicy({
      projection: { rootScopeId: "global", defaultScopeId: "scope", scopes: [
        { scopeId: "global", displayName: "Global" },
        { scopeId: "scope", displayName: "Scope", parentScopeId: "global", directoryRoot: root },
      ] }, scopeId: "scope", fragments: [{ scopeId: "scope", reason: "Bounded test writes", writes: { mode: "paths", paths } }],
    }) }),
  };
}
async function invoke(name: string, input: Record<string, unknown>, opts = options(["allowed/"])) {
  const [result] = await executeToolCalls([{ type: "tool_use", id: "call", name, input }], opts);
  return result;
}

describe("tool-owned filesystem authorization", () => {
  it.each(["agent", "scope"] as const)("does not replace an unresolved invocation with its static network effect under %s roots", async (gate) => {
    const target = join(root, "outside");
    disposers.push(registerTool({
      name: "unresolved_invocation_fixture", description: "An unresolved local mutation",
      input_schema: { type: "object", properties: {} },
    }, async () => {
      writeFileSync(target, "unauthorized");
      return { content: "written" };
    }, undefined, { effect: networkWriteEffect(), resolveEffect: () => undefined }));
    expect(await invoke("unresolved_invocation_fixture", { path: "allowed/decoy" }, options(["allowed/"], gate)))
      .toMatchObject({ is_error: true, content: expect.stringContaining("no declared tool effect") });
    expect(existsSync(target)).toBe(false);
  });

  it.each(["agent", "scope"] as const)("rejects module_factory decoys and permits the real target through %s roots", async (gate) => {
    const input = { action: "create", manifest: { name: "probe" }, path: join(root, "allowed/pretend.json") };
    const target = join(root, ".kota/modules/probe/manifest.json");
    expect(await invoke("module_factory", input, options(["allowed/"], gate))).toMatchObject({ is_error: true });
    expect(existsSync(target)).toBe(false);
    expect(await invoke("module_factory", input, options([".kota/modules/probe/"], gate))).not.toHaveProperty("is_error", true);
    expect(JSON.parse(readFileSync(target, "utf8"))).toMatchObject({ name: "probe" });
    expect(existsSync(input.path)).toBe(false);
  });

  it("allows observation under deny-all and retains destructive removal approval", async () => {
    const opts = options([".kota/modules/"]);
    expect(await invoke("module_factory", { action: "create", manifest: { name: "probe" } }, opts)).not.toHaveProperty("is_error", true);
    expect(await invoke("module_factory", { action: "list" }, { ...opts, agentWriteScope: "deny-all" })).not.toHaveProperty("is_error", true);
    const requests: string[] = [];
    const result = await invoke("module_factory", { action: "remove", name: "probe" }, {
      ...opts, clientApprovalResolver: async (request) => {
        requests.push(request.risk);
        return { outcome: "deny", message: "Keep this manifest" };
      },
    });
    expect(result).toMatchObject({ is_error: true });
    expect(requests).toEqual(["dangerous"]);
    expect(existsSync(join(root, ".kota/modules/probe/manifest.json"))).toBe(true);
  });

  it.each(["agent", "scope"] as const)("checks every target and fails closed on incomplete or opaque declarations through %s roots", async (gate) => {
    const destinations = [join(root, "allowed/one"), join(root, "outside")];
    let targets: readonly string[] | undefined = destinations;
    disposers.push(registerTool({ name: "batch_target_fixture", description: "Writes both owned destinations", input_schema: { type: "object", properties: {} } },
      async () => { for (const path of destinations) writeFileSync(path, "written"); return { content: "written" }; },
      undefined, { effect: localWriteEffect(), resolveFilesystemTargets: () => targets ? { kind: "known", paths: targets } : { kind: "unknown" } }));
    for (const declaration of [destinations, [], undefined, [destinations[0], "relative"]]) {
      targets = declaration;
      expect(await invoke("batch_target_fixture", { path: destinations[0] }, options(["allowed/"], gate))).toMatchObject({ is_error: true });
      expect(destinations.some(existsSync)).toBe(false);
    }
    targets = destinations;
    expect(await invoke("batch_target_fixture", {}, options(["allowed/", "outside"], gate))).toMatchObject({ content: "written" });
    expect(destinations.map((path) => readFileSync(path, "utf8"))).toEqual(["written", "written"]);
  });

  it("rejects a post-authorization input change before the runner writes", async () => {
    disposers.push(getToolMiddleware().add("target-substitution", async (call, next) => {
      call.input.manifest = { name: "outside" };
      return next();
    }));
    expect(await invoke("module_factory", { action: "create", manifest: { name: "probe" } }, options([".kota/modules/probe/"]))).toMatchObject({ is_error: true });
    expect(existsSync(join(root, ".kota/modules"))).toBe(false);
  });

  it("keeps nested execution bound to registered runners and inherited write roots", async () => {
    const target = join(root, "allowed/report");
    const outside = join(root, "outside");
    const tool = { name: "nested_target_fixture", description: "Writes an owned report", input_schema: { type: "object" as const, properties: {} } };
    const runner = async () => { writeFileSync(target, "report"); return { content: "written" }; };
    disposers.push(registerTool(tool, runner, undefined, {
      effect: localWriteEffect(), resolveFilesystemTargets: () => ({ kind: "known", paths: [target] }),
    }));
    const invokeNested = (selectedRunner = runner, agentWriteScope = ["allowed/"]) => executeDelegateToolBlocks({
      toolBlocks: [{ type: "tool_use", id: "nested", name: tool.name, input: {} }],
      tools: [tool], runners: { [tool.name]: selectedRunner },
      toolExecutionOptions: { ...options(agentWriteScope) },
      mcpMgr: undefined, isExecute: true, messages: [],
      modifiedFiles: new Set(), urlsFetched: new Set(), searchQueries: new Set(),
    });
    expect((await invokeNested(runner, ["elsewhere/"]))[0]).toMatchObject({ is_error: true });
    expect(existsSync(target)).toBe(false);
    expect((await invokeNested())[0]).toMatchObject({ content: "written" });
    expect(readFileSync(target, "utf8")).toBe("report");
    expect((await invokeNested(async () => {
      writeFileSync(outside, "unauthorized"); return { content: "written" };
    }))[0]).toMatchObject({ is_error: true });
    expect(existsSync(outside)).toBe(false);
  });

  it("grants only the isolated output root to a deny-all agent", async () => {
    const target = join(root, "allowed/report");
    disposers.push(registerTool({ name: "report_target_fixture", description: "Writes a report", input_schema: { type: "object", properties: { destination: { type: "string" } }, required: ["destination"] } },
      async (input, context) => { writeFileSync(resolve(context?.cwd ?? process.cwd(), String(input.destination)), "report"); return { content: "written" }; },
      undefined, { effect: localWriteEffect(), resolveFilesystemTargets: (input, context) => ({ kind: "known", paths: [resolve(context?.cwd ?? process.cwd(), String(input.destination))] }) }));
    const opts = { ...options(["tasks/"], "scope"), agentWriteScope: "deny-all" as const, agentOutputDir: join(root, "allowed") };
    expect(await invoke("report_target_fixture", { destination: target }, opts)).toMatchObject({ content: "written" });
    expect(await invoke("report_target_fixture", { destination: join(root, "sibling") }, opts)).toMatchObject({ is_error: true });
    expect(existsSync(join(root, "sibling"))).toBe(false);
  });
});
