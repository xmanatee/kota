import { describe, expect, it } from "vitest";
import type { ToolDef } from "#core/modules/module-types.js";
import {
  analyzeRemoteMcpToolDescriptionQuality,
  analyzeToolDefDescriptionQuality,
} from "./description-quality.js";
import {
  networkReadEffect,
  networkWriteEffect,
  readOnlyLocalEffect,
} from "./effect.js";

function toolDef(input: {
  name: string;
  description: string;
  effect: ToolDef["effect"];
  properties?: ToolDef["tool"]["input_schema"]["properties"];
  required?: string[];
  output?: boolean;
}): ToolDef {
  return {
    tool: {
      name: input.name,
      description: input.description,
      input_schema: {
        type: "object",
        properties: input.properties ?? {},
        ...(input.required ? { required: input.required } : {}),
      },
      ...(input.output
        ? {
            output_schema: {
              type: "object",
              properties: {
                result: { type: "string" },
              },
              required: ["result"],
            },
          }
        : {}),
    },
    effect: input.effect,
    runner: async () => ({ content: "ok" }),
  };
}

function codesFor(tool: ToolDef): string[] {
  return analyzeToolDefDescriptionQuality(tool).map((diagnostic) => diagnostic.code);
}

describe("tool description quality analyzer", () => {
  it("accepts a concrete local tool description with purpose, IO, effect, and negative guidance", () => {
    const diagnostics = analyzeToolDefDescriptionQuality(
      toolDef({
        name: "calendar_check",
        description:
          "Read calendar availability for `start` and `end` date inputs, then returns busy blocks. Use for scheduling checks, not for booking or edits.",
        effect: networkReadEffect(),
        properties: {
          start: { type: "string" },
          end: { type: "string" },
        },
        required: ["start", "end"],
        output: true,
      }),
    );

    expect(diagnostics).toEqual([]);
  });

  it("flags terse generic local tool descriptions", () => {
    const codes = codesFor(
      toolDef({
        name: "terse_tool",
        description: "Do it",
        effect: readOnlyLocalEffect(),
      }),
    );

    expect(codes).toContain("description-too-short");
    expect(codes).toContain("description-generic");
    expect(codes).toContain("missing-purpose");
  });

  it("flags high-authority local tools without negative-use guidance", () => {
    const codes = codesFor(
      toolDef({
        name: "email_send",
        description:
          "Send email to `to` with `subject` and `body`, then returns the provider message id.",
        effect: networkWriteEffect(),
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
        output: true,
      }),
    );

    expect(codes).toContain("negative-guidance-missing");
  });

  it("flags explicit description references to missing schema fields", () => {
    const codes = codesFor(
      toolDef({
        name: "event_read",
        description: "Read a calendar event by field `eventId` and return the event details.",
        effect: readOnlyLocalEffect(),
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      }),
    );

    expect(codes).toContain("schema-mismatch");
  });

  it("flags remote MCP tools with no description as warnings, not protocol errors", () => {
    const codes = analyzeRemoteMcpToolDescriptionQuality({
      name: "remote_lookup",
      inputSchema: {
        type: "object",
        properties: {},
      },
    }).map((diagnostic) => diagnostic.code);

    expect(codes).toContain("description-missing");
    expect(codes).toContain("effect-boundary-missing");
  });

  it("flags remote MCP tools with generic text", () => {
    const codes = analyzeRemoteMcpToolDescriptionQuality({
      name: "remote_generic",
      description: "Tool to do stuff",
      inputSchema: {
        type: "object",
        properties: {},
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    }).map((diagnostic) => diagnostic.code);

    expect(codes).toContain("description-generic");
    expect(codes).toContain("description-too-short");
  });
});
