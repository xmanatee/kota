import { describe, it, expect } from "vitest";
import {
  normalizeResult,
  fromSimple,
  fromOpenAI,
  fromVercelAI,
  extractJsonSchema,
  zodDefToJsonSchema,
  adaptExport,
  type SimpleTool,
  type OpenAIFunctionTool,
  type VercelAITool,
} from "./tool-adapters.js";

describe("normalizeResult", () => {
  it("passes through ToolResult objects", () => {
    const r = normalizeResult({ content: "hello", is_error: false });
    expect(r).toEqual({ content: "hello", is_error: false });
  });

  it("converts strings", () => {
    expect(normalizeResult("hello")).toEqual({ content: "hello" });
  });

  it("converts null/undefined to empty content", () => {
    expect(normalizeResult(null)).toEqual({ content: "" });
    expect(normalizeResult(undefined)).toEqual({ content: "" });
  });

  it("converts numbers", () => {
    expect(normalizeResult(42)).toEqual({ content: "42" });
  });

  it("converts booleans", () => {
    expect(normalizeResult(true)).toEqual({ content: "true" });
  });

  it("converts plain objects to JSON", () => {
    const r = normalizeResult({ foo: 1, bar: [2, 3] });
    expect(r.content).toBe(JSON.stringify({ foo: 1, bar: [2, 3] }, null, 2));
  });

  it("converts objects with text property", () => {
    expect(normalizeResult({ text: "hello" })).toEqual({ content: "hello" });
  });

  it("prefers content over text", () => {
    expect(normalizeResult({ content: "a", text: "b" })).toEqual({ content: "a", text: "b" });
  });
});

describe("fromSimple", () => {
  it("converts a simple tool definition", async () => {
    const simple: SimpleTool = {
      name: "greet",
      description: "Greet someone",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      run: async ({ name }) => `Hello, ${name}!`,
    };

    const def = fromSimple(simple);
    expect(def.tool.name).toBe("greet");
    expect(def.tool.description).toBe("Greet someone");
    expect(def.tool.input_schema.properties).toEqual({ name: { type: "string" } });

    const result = await def.runner({ name: "World" });
    expect(result.content).toBe("Hello, World!");
  });

  it("defaults parameters to empty object", () => {
    const def = fromSimple({
      name: "noop",
      description: "Does nothing",
      run: async () => "done",
    });
    expect(def.tool.input_schema).toEqual({ type: "object", properties: {} });
  });

  it("preserves group", () => {
    const def = fromSimple({
      name: "t",
      description: "",
      run: async () => "",
      group: "mygroup",
    });
    expect(def.group).toBe("mygroup");
  });

  it("throws on missing name", () => {
    expect(() =>
      fromSimple({ name: "", description: "", run: async () => "" }),
    ).toThrow("non-empty 'name'");
  });

  it("throws on missing run", () => {
    expect(() =>
      fromSimple({ name: "x", description: "" } as unknown as SimpleTool),
    ).toThrow("'run' function");
  });

  it("normalizes return values through normalizeResult", async () => {
    const def = fromSimple({
      name: "num",
      description: "",
      run: async () => 42,
    });
    const result = await def.runner({});
    expect(result.content).toBe("42");
  });
});

describe("fromOpenAI", () => {
  it("converts an OpenAI function-calling tool", async () => {
    const openai: OpenAIFunctionTool = {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
          type: "object",
          properties: { location: { type: "string" } },
          required: ["location"],
        },
      },
      run: async ({ location }) => ({ temp: 72, location }),
    };

    const def = fromOpenAI(openai);
    expect(def.tool.name).toBe("get_weather");
    expect(def.tool.description).toBe("Get weather for a location");

    const result = await def.runner({ location: "NYC" });
    expect(JSON.parse(result.content)).toEqual({ temp: 72, location: "NYC" });
  });

  it("defaults parameters", () => {
    const def = fromOpenAI({
      type: "function",
      function: { name: "ping" },
      run: async () => "pong",
    });
    expect(def.tool.input_schema).toEqual({ type: "object", properties: {} });
  });

  it("throws on missing function.name", () => {
    expect(() =>
      fromOpenAI({
        type: "function",
        function: {} as { name: string },
        run: async () => "",
      }),
    ).toThrow("function.name");
  });

  it("throws on missing run", () => {
    expect(() =>
      fromOpenAI({
        type: "function",
        function: { name: "x" },
      } as unknown as OpenAIFunctionTool),
    ).toThrow("'run' function");
  });
});

describe("fromVercelAI", () => {
  it("converts a Vercel AI SDK tool with JSON Schema parameters", async () => {
    const vercel: VercelAITool = {
      description: "Get weather for a location",
      parameters: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      },
      execute: async ({ location }) => ({ temp: 72, location }),
    };

    const def = fromVercelAI(vercel, "get_weather");
    expect(def.tool.name).toBe("get_weather");
    expect(def.tool.description).toBe("Get weather for a location");
    expect(def.tool.input_schema.properties).toEqual({ location: { type: "string" } });

    const result = await def.runner({ location: "NYC" });
    expect(JSON.parse(result.content)).toEqual({ temp: 72, location: "NYC" });
  });

  it("handles Zod-like schema objects", async () => {
    // Simulate a Zod object schema structure
    const zodSchema = {
      _def: {
        typeName: "ZodObject",
        shape: () => ({
          city: { _def: { typeName: "ZodString" } },
          units: {
            _def: { typeName: "ZodOptional", innerType: { _def: { typeName: "ZodString" } } },
          },
        }),
      },
    };

    const def = fromVercelAI(
      { description: "Weather", parameters: zodSchema, execute: async () => "sunny" },
      "weather",
    );
    expect(def.tool.input_schema.properties).toEqual({
      city: { type: "string" },
      units: { type: "string" },
    });
    expect(def.tool.input_schema.required).toEqual(["city"]);
  });

  it("handles AI SDK jsonSchema() format", () => {
    const params = {
      jsonSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    };

    const def = fromVercelAI(
      { description: "Search", parameters: params, execute: async () => [] },
      "search",
    );
    expect(def.tool.input_schema.properties).toEqual({ query: { type: "string" } });
  });

  it("throws on missing execute", () => {
    expect(() =>
      fromVercelAI({ description: "bad", parameters: {} } as unknown as VercelAITool, "bad"),
    ).toThrow("'execute' function");
  });

  it("preserves group", () => {
    const def = fromVercelAI(
      { description: "", parameters: {}, execute: async () => "", group: "web" },
      "t",
    );
    expect(def.group).toBe("web");
  });

  it("normalizes return values", async () => {
    const def = fromVercelAI(
      { description: "", parameters: {}, execute: async () => 42 },
      "num",
    );
    const result = await def.runner({});
    expect(result.content).toBe("42");
  });
});

describe("extractJsonSchema", () => {
  it("returns empty schema for null/undefined", () => {
    expect(extractJsonSchema(null)).toEqual({ type: "object", properties: {} });
    expect(extractJsonSchema(undefined)).toEqual({ type: "object", properties: {} });
  });

  it("passes through JSON Schema objects", () => {
    const schema = { type: "object", properties: { x: { type: "number" } } };
    expect(extractJsonSchema(schema)).toEqual(schema);
  });

  it("extracts from AI SDK jsonSchema()", () => {
    const wrapped = { jsonSchema: { type: "object", properties: { q: { type: "string" } } } };
    expect(extractJsonSchema(wrapped)).toEqual({ type: "object", properties: { q: { type: "string" } } });
  });
});

describe("zodDefToJsonSchema", () => {
  it("converts ZodString", () => {
    expect(zodDefToJsonSchema({ _def: { typeName: "ZodString" } })).toEqual({ type: "string" });
  });

  it("converts ZodNumber", () => {
    expect(zodDefToJsonSchema({ _def: { typeName: "ZodNumber" } })).toEqual({ type: "number" });
  });

  it("converts ZodBoolean", () => {
    expect(zodDefToJsonSchema({ _def: { typeName: "ZodBoolean" } })).toEqual({ type: "boolean" });
  });

  it("converts ZodEnum", () => {
    expect(zodDefToJsonSchema({ _def: { typeName: "ZodEnum", values: ["a", "b"] } }))
      .toEqual({ type: "string", enum: ["a", "b"] });
  });

  it("converts ZodArray", () => {
    const schema = {
      _def: {
        typeName: "ZodArray",
        type: { _def: { typeName: "ZodString" } },
      },
    };
    expect(zodDefToJsonSchema(schema)).toEqual({ type: "array", items: { type: "string" } });
  });

  it("converts ZodOptional (unwraps)", () => {
    const schema = {
      _def: {
        typeName: "ZodOptional",
        innerType: { _def: { typeName: "ZodNumber" } },
      },
    };
    expect(zodDefToJsonSchema(schema)).toEqual({ type: "number" });
  });

  it("converts ZodDefault (unwraps)", () => {
    const schema = {
      _def: {
        typeName: "ZodDefault",
        innerType: { _def: { typeName: "ZodBoolean" } },
      },
    };
    expect(zodDefToJsonSchema(schema)).toEqual({ type: "boolean" });
  });

  it("converts ZodObject with required fields", () => {
    const schema = {
      _def: {
        typeName: "ZodObject",
        shape: () => ({
          name: { _def: { typeName: "ZodString" } },
          age: { _def: { typeName: "ZodNumber" } },
          bio: { _def: { typeName: "ZodOptional", innerType: { _def: { typeName: "ZodString" } } } },
        }),
      },
    };
    const result = zodDefToJsonSchema(schema);
    expect(result.type).toBe("object");
    expect(result.properties).toEqual({
      name: { type: "string" },
      age: { type: "number" },
      bio: { type: "string" },
    });
    expect(result.required).toEqual(["name", "age"]);
  });

  it("includes description when present", () => {
    const schema = { _def: { typeName: "ZodString" }, description: "A user name" };
    expect(zodDefToJsonSchema(schema)).toEqual({ type: "string", description: "A user name" });
  });

  it("handles ZodLiteral", () => {
    expect(zodDefToJsonSchema({ _def: { typeName: "ZodLiteral", value: "hello" } }))
      .toEqual({ const: "hello" });
  });

  it("returns empty object for unknown types", () => {
    expect(zodDefToJsonSchema({ _def: { typeName: "ZodSomethingNew" } })).toEqual({});
  });

  it("handles null/undefined input", () => {
    expect(zodDefToJsonSchema(null)).toEqual({});
    expect(zodDefToJsonSchema(undefined)).toEqual({});
  });
});

describe("adaptExport", () => {
  it("passes through native KotaPlugin format", () => {
    const plugin = {
      name: "native",
      tools: [
        {
          tool: { name: "t", description: "d", input_schema: { type: "object" } },
          runner: async () => ({ content: "ok" }),
        },
      ],
    };
    const result = adaptExport(plugin, "native.js");
    expect(result.name).toBe("native");
    expect(result.tools).toHaveLength(1);
  });

  it("adapts a single simple tool export", async () => {
    const exported = {
      name: "hello",
      description: "Say hello",
      run: async () => "Hello!",
    };
    const plugin = adaptExport(exported, "hello.js");
    expect(plugin.name).toBe("hello");
    expect(plugin.tools).toHaveLength(1);
    expect(plugin.tools![0].tool.name).toBe("hello");

    const result = await plugin.tools![0].runner({});
    expect(result.content).toBe("Hello!");
  });

  it("adapts a single OpenAI format export", async () => {
    const exported = {
      type: "function",
      function: { name: "calc", description: "Calculate" },
      run: async () => 42,
    };
    const plugin = adaptExport(exported, "calc.mjs");
    expect(plugin.name).toBe("calc");
    expect(plugin.tools).toHaveLength(1);

    const result = await plugin.tools![0].runner({});
    expect(result.content).toBe("42");
  });

  it("adapts an array of simple tools", async () => {
    const exported = [
      { name: "add", description: "Add", run: async ({ a, b }: { a: number; b: number }) => a + b },
      { name: "sub", description: "Sub", run: async ({ a, b }: { a: number; b: number }) => a - b },
    ];
    const plugin = adaptExport(exported, "math.js");
    expect(plugin.name).toBe("math");
    expect(plugin.tools).toHaveLength(2);
    expect(plugin.tools![0].tool.name).toBe("add");
    expect(plugin.tools![1].tool.name).toBe("sub");

    const r1 = await plugin.tools![0].runner({ a: 3, b: 2 });
    expect(r1.content).toBe("5");
    const r2 = await plugin.tools![1].runner({ a: 3, b: 2 });
    expect(r2.content).toBe("1");
  });

  it("adapts a mixed array of simple and OpenAI tools", () => {
    const exported = [
      { name: "simple_tool", description: "Simple", run: async () => "s" },
      {
        type: "function",
        function: { name: "openai_tool", description: "OpenAI" },
        run: async () => "o",
      },
    ];
    const plugin = adaptExport(exported, "mixed.js");
    expect(plugin.tools).toHaveLength(2);
    expect(plugin.tools![0].tool.name).toBe("simple_tool");
    expect(plugin.tools![1].tool.name).toBe("openai_tool");
  });

  it("adapts a KotaPlugin with simple-format tools array", async () => {
    const exported = {
      name: "hybrid",
      tools: [
        { name: "tool_a", description: "A", run: async () => "a" },
        { name: "tool_b", description: "B", run: async () => "b" },
      ],
      onLoad: async () => {},
    };
    const plugin = adaptExport(exported, "hybrid.js");
    expect(plugin.name).toBe("hybrid");
    expect(plugin.tools).toHaveLength(2);
    expect(plugin.tools![0].tool.name).toBe("tool_a");
    expect(plugin.onLoad).toBeDefined();

    const result = await plugin.tools![0].runner({});
    expect(result.content).toBe("a");
  });

  it("throws on non-object export", () => {
    expect(() => adaptExport("not an object" as unknown, "bad.js")).toThrow("not an object");
  });

  it("throws on empty array", () => {
    expect(() => adaptExport([], "empty.js")).toThrow("empty tool array");
  });

  it("throws on unrecognized format", () => {
    expect(() => adaptExport({ foo: "bar" }, "weird.js")).toThrow("unrecognized export format");
  });

  it("derives plugin name from filename", () => {
    const exported = {
      type: "function",
      function: { name: "t" },
      run: async () => "",
    };
    const plugin = adaptExport(exported, "my-cool-plugin.mjs");
    expect(plugin.name).toBe("my-cool-plugin");
  });

  it("handles synchronous run functions", async () => {
    const exported = {
      name: "sync",
      description: "Sync tool",
      run: () => "sync result",
    };
    const plugin = adaptExport(exported, "sync.js");
    const result = await plugin.tools![0].runner({});
    expect(result.content).toBe("sync result");
  });

  it("adapts a single Vercel AI SDK tool export", async () => {
    const exported = {
      description: "Get weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
      execute: async ({ city }: { city: string }) => `Weather in ${city}: sunny`,
    };
    const plugin = adaptExport(exported, "weather.js");
    expect(plugin.name).toBe("weather");
    expect(plugin.tools).toHaveLength(1);
    expect(plugin.tools![0].tool.name).toBe("weather");

    const result = await plugin.tools![0].runner({ city: "NYC" });
    expect(result.content).toBe("Weather in NYC: sunny");
  });

  it("adapts a map of Vercel AI SDK tools", async () => {
    const exported = {
      get_weather: {
        description: "Get weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
        execute: async () => "sunny",
      },
      search: {
        description: "Search web",
        parameters: { type: "object", properties: { query: { type: "string" } } },
        execute: async () => "results",
      },
    };
    const plugin = adaptExport(exported, "tools.js");
    expect(plugin.tools).toHaveLength(2);
    expect(plugin.tools![0].tool.name).toBe("get_weather");
    expect(plugin.tools![1].tool.name).toBe("search");

    const r1 = await plugin.tools![0].runner({});
    expect(r1.content).toBe("sunny");
  });

  it("adapts a Vercel AI SDK tool with Zod-like parameters", async () => {
    const exported = {
      description: "Search",
      parameters: {
        _def: {
          typeName: "ZodObject",
          shape: () => ({
            query: { _def: { typeName: "ZodString" } },
          }),
        },
      },
      execute: async () => "found it",
    };
    const plugin = adaptExport(exported, "search.mjs");
    expect(plugin.tools![0].tool.input_schema.properties).toEqual({ query: { type: "string" } });
  });

  it("adapts an array containing Vercel AI SDK tools", () => {
    const exported = [
      {
        description: "Tool A",
        parameters: { type: "object", properties: {} },
        execute: async () => "a",
      },
    ];
    const plugin = adaptExport(exported, "vercel-tools.js");
    expect(plugin.tools).toHaveLength(1);
    expect(plugin.tools![0].tool.name).toBe("tool_0");
  });
});
