/**
 * Integration tests for `custom_tool` end-to-end execution against real
 * Python and Node.js REPL sessions. Lives in the execution module because
 * the tests depend on the module's CodeRunner adapter; the matching unit
 * tests stay in `src/core/tools/custom-tool.test.ts` and do not spawn
 * runtimes.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { manifestToModule } from "#core/manifest/execution.js";
import { resetCodeRunners } from "#core/tools/code-runner.js";
import { resetCustomTools, runCustomTool } from "#core/tools/custom-tool.js";
import { executeTool } from "#core/tools/index.js";
import {
  deregisterExecutionCodeRunners,
  registerExecutionCodeRunners,
} from "./code-runner-adapter.js";
import { cleanupSessions } from "./repl-session.js";

const envKeys = [
  "KOTA_SESSION_ID",
  "KOTA_TOOL_USE_ID",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTLP_ENDPOINT",
] as const;

function snapshotEnv(): Record<(typeof envKeys)[number], string | undefined> {
  const saved = {} as Record<(typeof envKeys)[number], string | undefined>;
  for (const key of envKeys) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<(typeof envKeys)[number], string | undefined>): void {
  for (const key of envKeys) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("custom_tool execution against the execution module runners", () => {
  beforeAll(() => {
    resetCodeRunners();
    registerExecutionCodeRunners();
  });

  afterAll(() => {
    cleanupSessions();
    deregisterExecutionCodeRunners();
    resetCustomTools();
  });

  beforeEach(() => {
    resetCustomTools();
  });

  it("executes a Python custom tool", async () => {
    await runCustomTool({
      action: "create",
      name: "add_numbers",
      description: "Add two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
      },
      code: "print(params['a'] + params['b'])",
      language: "python",
    });

    const result = await executeTool("add_numbers", { a: 3, b: 7 });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("10");
  });

  it("executes a Node.js custom tool", async () => {
    await runCustomTool({
      action: "create",
      name: "reverse_string",
      description: "Reverse a string",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      code: "console.log(params.text.split('').reverse().join(''))",
      language: "node",
    });

    const result = await executeTool("reverse_string", { text: "hello" });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("olleh");
  });

  it("handles errors in custom tool code gracefully", async () => {
    await runCustomTool({
      action: "create",
      name: "will_fail",
      description: "This will error",
      code: "raise ValueError('intentional error')",
      language: "python",
    });

    const result = await executeTool("will_fail", {});
    expect(result.content).toContain("ValueError");
    expect(result.content).toContain("intentional error");
  });

  it("passes complex parameters correctly", async () => {
    await runCustomTool({
      action: "create",
      name: "format_data",
      description: "Format structured data",
      parameters: {
        type: "object",
        properties: {
          items: { type: "array" },
          separator: { type: "string" },
        },
      },
      code: "print(params['separator'].join(str(x) for x in params['items']))",
      language: "python",
    });

    const result = await executeTool("format_data", {
      items: [1, 2, 3],
      separator: " | ",
    });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("1 | 2 | 3");
  });

  it("handles params with special characters", async () => {
    await runCustomTool({
      action: "create",
      name: "echo_special",
      description: "Echo text with special chars",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      code: "print(params['text'])",
      language: "python",
    });

    const result = await executeTool("echo_special", {
      text: "Hello 'world' \"test\" \n newline & special <chars>",
    });
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain("Hello 'world'");
  });

  it("passes context and scrubs telemetry for Python custom tools", async () => {
    const saved = snapshotEnv();
    try {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://kota-collector";
      process.env.OTLP_ENDPOINT = "http://legacy-collector";
      cleanupSessions();

      await runCustomTool({
        action: "create",
        name: "env_probe_python",
        description: "Read selected environment values",
        code: [
          "import os",
          "print(os.environ.get('KOTA_SESSION_ID', 'missing'))",
          "print(os.environ.get('KOTA_TOOL_USE_ID', 'missing'))",
          "print(os.environ.get('OTEL_EXPORTER_OTLP_ENDPOINT', 'missing'))",
          "print(os.environ.get('OTLP_ENDPOINT', 'missing'))",
        ].join("\n"),
        language: "python",
      });

      const result = await executeTool(
        "env_probe_python",
        {},
        { sessionId: "custom-session", toolUseId: "custom-tool-use" },
      );

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain(
        "custom-session\ncustom-tool-use\nmissing\nmissing",
      );
      expect(result.content).not.toContain("kota-collector");
      expect(result.content).not.toContain("legacy-collector");
    } finally {
      cleanupSessions();
      restoreEnv(saved);
    }
  });

  it("applies context and scrubs parent variables for manifest-code tools", async () => {
    const saved = snapshotEnv();
    try {
      process.env.KOTA_SESSION_ID = "parent-session";
      process.env.KOTA_TOOL_USE_ID = "parent-tool";
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://kota-collector";
      process.env.OTLP_ENDPOINT = "http://legacy-collector";
      cleanupSessions();

      const mod = manifestToModule({
        name: "manifest-env-probe",
        description: "Manifest env probe",
        tools: [
          {
            name: "manifest_env_probe",
            description: "Read selected environment values",
            language: "node",
            code: [
              "console.log(process.env.KOTA_SESSION_ID ?? 'missing')",
              "console.log(process.env.KOTA_TOOL_USE_ID ?? 'missing')",
              "console.log(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'missing')",
              "console.log(process.env.OTLP_ENDPOINT ?? 'missing')",
            ].join("\n"),
          },
        ],
      });

      const moduleTools = Array.isArray(mod.tools) ? mod.tools : undefined;
      const runner = moduleTools?.[0]?.runner;
      if (!runner) throw new Error("manifest runner missing");
      const contextual = await runner(
        {},
        { sessionId: "manifest-session", toolUseId: "manifest-tool-use" },
      );
      expect(contextual.is_error).toBeFalsy();
      expect(contextual.content).toContain(
        "manifest-session\nmanifest-tool-use\nmissing\nmissing",
      );
      expect(contextual.content).not.toContain("kota-collector");
      expect(contextual.content).not.toContain("legacy-collector");

      const result = await runner({});

      expect(result.is_error).toBeFalsy();
      expect(result.content).toContain("missing\nmissing\nmissing\nmissing");
      expect(result.content).not.toContain("parent-session");
      expect(result.content).not.toContain("parent-tool");
      expect(result.content).not.toContain("kota-collector");
      expect(result.content).not.toContain("legacy-collector");
    } finally {
      cleanupSessions();
      restoreEnv(saved);
    }
  });
});
