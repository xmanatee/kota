import { describe, expect, it } from "vitest";
import { z } from "zod/v3";
import type { KotaModule, ToolDef } from "#core/modules/module-types.js";
import type { OpenAIFunctionTool, SimpleTool, VercelAITool } from "./tool-adapter-types.js";
import { adaptExport, fromOpenAI, fromSimple, fromVercelAI } from "./tool-adapters.js";
import { normalizeResult } from "./tool-adapters-zod.js";

function toolsOf(mod: KotaModule): ToolDef[] {
  if (!Array.isArray(mod.tools)) throw new Error("Expected static adapted tools");
  return mod.tools;
}

const parameters = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
};
const run = ({ query }: Record<string, unknown>) => ({ query });
const simple: SimpleTool = { name: "search", description: "Search", parameters, run };
const openai: OpenAIFunctionTool = {
  type: "function", function: { name: "search", description: "Search", parameters }, run,
};
const vercel: VercelAITool = { description: "Search", parameters, execute: run };
const adapters = [
  { name: "simple", make: (params: Record<string, unknown> | undefined) => fromSimple({ ...simple, parameters: params }) },
  { name: "openai", make: (params: Record<string, unknown> | undefined) => fromOpenAI({ ...openai, function: { ...openai.function, parameters: params } }) },
  { name: "vercel", make: (params: Record<string, unknown> | undefined) => fromVercelAI({ ...vercel, parameters: params }, "search") },
];

describe("tool format adaptation", () => {
  it.each(adapters)("$name propagates parameters, input and normalized output", async ({ make }) => {
    const def = make(parameters);
    expect(def.tool).toEqual({ name: "search", description: "Search", input_schema: parameters });
    expect(await def.runner({ query: "weather" })).toEqual({ content: '{\n  "query": "weather"\n}' });
  });

  it.each(adapters)("$name normalizes absent and non-object parameter schemas", ({ make }) => {
    for (const params of [undefined, { type: "string" }]) {
      expect(make(params).tool.input_schema).toEqual({ type: "object", properties: {} });
    }
  });

  it.each([
    ["simple name", () => fromSimple({ ...simple, name: "" }), "non-empty 'name'"],
    ["simple runner", () => fromSimple({ ...simple, run: undefined } as unknown as SimpleTool), "'run' function"],
    ["openai name", () => fromOpenAI({ ...openai, function: { name: "" } }), "function.name"],
    ["openai runner", () => fromOpenAI({ ...openai, run: undefined } as unknown as OpenAIFunctionTool), "'run' function"],
    ["vercel runner", () => fromVercelAI({ ...vercel, execute: undefined } as unknown as VercelAITool, "search"), "'execute' function"],
  ] as const)("rejects missing %s", (_name, invoke, message) => {
    expect(invoke).toThrow(message);
  });

  it.each([
    ["safe", "discovery", { kind: "read", scope: "local-fs", idempotent: true, openWorld: false }],
    ["safe", "action", { kind: "write", scope: "daemon-state", idempotent: false, openWorld: false }],
    ["moderate", "action", { kind: "write", scope: "local-fs", idempotent: false, openWorld: false }],
    ["dangerous", "action", { kind: "destructive", scope: "external-network", idempotent: false, openWorld: true }],
  ] as const)("preserves %s/%s effects across external formats", (risk, kind, effect) => {
    const metadata = { risk, kind, group: "external" };
    const defs = [fromSimple({ ...simple, ...metadata }), fromOpenAI({ ...openai, ...metadata }), fromVercelAI({ ...vercel, ...metadata }, "search")];
    for (const def of defs) expect(def).toMatchObject({ effect, group: "external" });
  });

  it.each(adapters)("$name defaults undeclared risk to a local write", ({ make }) => {
    expect(make(parameters).effect).toEqual({ kind: "write", scope: "local-fs", idempotent: false, openWorld: false });
  });
});

describe("module export boundary", () => {
  it.each([
    ["simple", simple, "search", ["search"]],
    ["openai", openai, "external_tools", ["search"]],
    ["vercel", vercel, "external_tools", ["external_tools"]],
    ["map", { search: vercel, second: vercel }, "external_tools", ["search", "second"]],
    ["array", [simple, openai, vercel], "external_tools", ["search", "search", "tool_2"]],
    ["simple with module fields", { ...simple, tools: [] }, "search", ["search"]],
  ] as const)("adapts %s with executable tools", async (_name, exported, moduleName, toolNames) => {
    const mod = adaptExport(exported, "external.tools.mjs");
    expect(mod.name).toBe(moduleName);
    const defs = toolsOf(mod);
    expect(defs.map((def) => def.tool.name)).toEqual(toolNames);
    for (const def of defs) {
      expect(def.tool.input_schema).toEqual(parameters);
      expect(JSON.parse((await def.runner({ query: "forwarded" })).content)).toEqual({ query: "forwarded" });
    }
  });

  it("preserves a native module and its tool behavior", async () => {
    const native: KotaModule = { name: "native", tools: [fromSimple(simple)] };
    const mod = adaptExport(native, "native.ts");
    expect(mod).toBe(native);
    expect(JSON.parse((await toolsOf(mod)[0].runner({ query: "native" })).content)).toEqual({ query: "native" });
  });

  it("preserves a native module factory without invoking it during adaptation", () => {
    const native: KotaModule = { name: "factory", tools: () => { throw new Error("requires activation"); } };
    expect(adaptExport(native, "factory.ts")).toBe(native);
    expect(adaptExport({ name: "empty", tools: [] }, "empty.ts")).toEqual({ name: "empty", tools: [] });
  });

  it("retains module metadata and lifecycle while adapting external tool entries", async () => {
    const onLoad: NonNullable<KotaModule["onLoad"]> = async () => {};
    const mod = adaptExport({ name: "hybrid", version: "2", description: "Hybrid", tools: [simple], onLoad }, "hybrid.js");
    expect(mod).toMatchObject({ name: "hybrid", version: "2", description: "Hybrid", onLoad });
    expect(JSON.parse((await toolsOf(mod)[0].runner({ query: "hybrid" })).content)).toEqual({ query: "hybrid" });
  });

  it.each([
    ["scalar", "invalid", "not an object"],
    ["null", null, "not an object"],
    ["empty array", [], "empty tool array"],
    ["unknown object", { unrecognized: true }, "unrecognized export format"],
    ["empty object", {}, "unrecognized export format"],
    ["partial map", { good: vercel, bad: "invalid" }, "unrecognized export format"],
    ["primitive array member", [simple, null], "array items must be objects"],
    ["all bad array", [{ unrecognized: true }, { ...openai, run: undefined }], "no valid tools"],
  ] as const)("rejects %s", (_name, exported, message) => {
    expect(() => adaptExport(exported, "bad.js")).toThrow(message);
  });

  it.each(["array", "module"])("isolates invalid entries in a %s and retains every healthy runner", async (container) => {
    const items = [simple, { unrecognized: true }, { ...openai, run: undefined }, vercel, fromSimple({ ...simple, name: "native" })];
    const mod = adaptExport(container === "array" ? items : { name: "mixed", tools: items }, "mixed.js");
    const defs = toolsOf(mod);
    expect(defs.map((def) => def.tool.name)).toEqual(["search", "tool_3", "native"]);
    for (const def of defs) expect(JSON.parse((await def.runner({ query: "healthy" })).content)).toEqual({ query: "healthy" });
  });
});

describe("external result normalization", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  class ApiError extends Error { statusCode = 404; }

  it.each([
    ["null", null, { content: "" }],
    ["undefined", undefined, { content: "" }],
    ["string", "hello", { content: "hello" }],
    ["number", 42, { content: "42" }],
    ["boolean", true, { content: "true" }],
    ["JSON", { items: [1, 2] }, { content: JSON.stringify({ items: [1, 2] }, null, 2) }],
    ["text", { text: "hello" }, { content: "hello" }],
    ["tool result", { content: "failed", is_error: true }, { content: "failed", is_error: true }],
    ["content precedence", { content: "a", text: "b" }, { content: "a", text: "b" }],
    ["error", new Error("failure"), { content: "failure" }],
    ["empty error", new Error(), { content: "Error" }],
    ["error subclass", new ApiError("Not Found"), { content: "Not Found" }],
    ["circular", circular, { content: "[object — could not serialize (circular reference or non-serializable)]" }],
  ])("normalizes %s", (_name, input, output) => {
    expect(normalizeResult(input)).toEqual(output);
  });

  it.each([
    ["synchronous", (): number => 42],
    ["asynchronous", async (): Promise<number> => 42],
  ] as const)("normalizes %s results at every adapter", async (_name, runner) => {
    const defs = [fromSimple({ ...simple, run: runner }), fromOpenAI({ ...openai, run: runner }), fromVercelAI({ ...vercel, execute: runner }, "search")];
    for (const def of defs) expect(await def.runner({})).toEqual({ content: "42" });
  });
});

describe("Vercel parameter conversion", () => {
  it.each([
    ["raw JSON Schema", parameters],
    ["AI SDK wrapper", { jsonSchema: parameters }],
    ["Zod object", z.object({ query: z.string() })],
  ])("propagates %s through export adaptation", (_name, schema) => {
    const mod = adaptExport({ ...vercel, parameters: schema }, "search.js");
    expect(toolsOf(mod)[0].tool.input_schema).toEqual(parameters);
  });

  it("converts real nested Zod fields, preserving descriptions, nullability and defaults", () => {
    const schema = z.object({
      name: z.string().describe("Name"),
      enabled: z.boolean(),
      roles: z.array(z.enum(["reader", "writer"])),
      tag: z.literal("query"),
      age: z.number().nullable().describe("Age"),
      bio: z.string().nullable().optional().describe("Biography"),
      limit: z.number().default(10).describe("Limit"),
      inner: z.string().describe("inner").optional().describe("outer"),
      nested: z.object({ value: z.string() }),
    });
    const mod = adaptExport({ ...vercel, parameters: schema }, "search.js");
    expect(toolsOf(mod)[0].tool.input_schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "Name" },
        enabled: { type: "boolean" },
        roles: { type: "array", items: { type: "string", enum: ["reader", "writer"] } },
        tag: { const: "query" },
        age: { type: ["number", "null"], description: "Age" },
        bio: { type: ["string", "null"], description: "Biography" },
        limit: { type: "number", default: 10, description: "Limit" },
        inner: { type: "string", description: "inner" },
        nested: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      },
      required: ["name", "enabled", "roles", "tag", "age", "nested"],
    });
  });

  it("contains throwing defaults and unsupported nullable Zod fields", () => {
    const schema = z.object({
      fallback: z.string().default(() => { throw new Error("unavailable default"); }),
      opaque: z.unknown().nullable().describe("Opaque"),
    });
    expect(fromVercelAI({ ...vercel, parameters: schema }, "search").tool.input_schema).toEqual({
      type: "object", properties: { fallback: { type: "string" }, opaque: { description: "Opaque" } }, required: ["opaque"],
    });
  });

  it.each([null, undefined, "invalid", {}, z.string()])("normalizes unusable root parameters %#", (schema) => {
    expect(fromVercelAI({ ...vercel, parameters: schema }, "search").tool.input_schema).toEqual({ type: "object", properties: {} });
  });
});
