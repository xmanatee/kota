import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOnlyLocalEffect } from "./effect.js";
import { registerTool } from "./index.js";
import { executeToolCalls, type ToolCallExecutionOptions } from "./tool-runner.js";

let root: string;
const disposers: Array<() => void> = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-read-scope-"));
  mkdirSync(join(root, "workspace"));
  mkdirSync(join(root, "evidence"));
  writeFileSync(join(root, "workspace", "source.txt"), "source");
  writeFileSync(join(root, "evidence", "selected.txt"), "selected");
  writeFileSync(join(root, "evidence", "private.txt"), "private");
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  rmSync(root, { recursive: true, force: true });
});

function options(readRoots: readonly string[]): ToolCallExecutionOptions {
  return {
    resultLimit: 50_000,
    verbose: false,
    autonomyMode: "autonomous",
    cwd: join(root, "workspace"),
    scopeRoot: root,
    agentReadScope: readRoots,
  };
}

describe("agent local read scope", () => {
  it("allows the workspace and selected files while denying siblings and symlink escapes", async () => {
    const tool = {
      name: "scoped_read_fixture",
      description: "Read one declared file",
      input_schema: {
        type: "object" as const,
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    };
    disposers.push(registerTool(tool, async (input) => ({
      content: readFileSync(String(input.path), "utf8"),
    }), undefined, {
      effect: readOnlyLocalEffect(),
      resolveFilesystemTargets: (input) => ({
        kind: "known",
        paths: [String(input.path)],
      }),
    }));

    const selected = join(root, "evidence", "selected.txt");
    const privatePath = join(root, "evidence", "private.txt");
    const alias = join(root, "workspace", "private-alias.txt");
    symlinkSync(privatePath, alias);
    const invoke = async (path: string) => (await executeToolCalls([
      { type: "tool_use", id: path, name: tool.name, input: { path } },
    ], options([join(root, "workspace"), selected])))[0];

    expect(await invoke(join(root, "workspace", "source.txt"))).toMatchObject({ content: "source" });
    expect(await invoke(selected)).toMatchObject({ content: "selected" });
    expect(await invoke(privatePath)).toMatchObject({
      is_error: true,
      content: expect.stringContaining("outside the declared read roots"),
    });
    expect(await invoke(alias)).toMatchObject({ is_error: true });
    expect(existsSync(privatePath)).toBe(true);
  });

  it("fails closed when a local read tool does not declare complete targets", async () => {
    disposers.push(registerTool({
      name: "opaque_read_fixture",
      description: "Read without a target declaration",
      input_schema: { type: "object", properties: {} },
    }, async () => ({ content: "unreachable" }), undefined, {
      effect: readOnlyLocalEffect(),
    }));
    const [result] = await executeToolCalls([
      { type: "tool_use", id: "opaque", name: "opaque_read_fixture", input: {} },
    ], options([join(root, "workspace")]));
    expect(result).toMatchObject({
      is_error: true,
      content: expect.stringContaining("require complete targets"),
    });
  });
});
