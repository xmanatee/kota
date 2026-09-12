import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveScopePolicy } from "#core/daemon/scope-policy.js";
import { registerTool } from "#core/tools/tool-registry.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import filesystemModule from "#modules/filesystem/index.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

// Detects disclosure when tool dispatch runs in a worktree outside its canonical
// scope, including stores whose resolved location no longer has a protected name.
it.each([
  { relocated: false, fallback: false },
  { relocated: true, fallback: false },
  { relocated: false, fallback: true },
  { relocated: true, fallback: true },
])("protects conversations through registered reads and searches ($relocated, fallback: $fallback)", async ({ relocated, fallback }) => {
  const root = mkdtempSync(join(tmpdir(), "kota-conversation-access-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  if (fallback) {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const grep = execFileSync("which", ["grep"], { encoding: "utf8" }).trim();
    symlinkSync(grep, join(bin, "grep"));
    vi.stubEnv("PATH", bin);
  }
  const canonicalScope = join(root, "canonical");
  const cwd = join(root, "worktree");
  const scopeRoot = join(root, "scope-alias");
  const store = join(canonicalScope, ".kota/openai-tools-agent-harness/sessions");
  mkdirSync(store, { recursive: true });
  mkdirSync(cwd);
  symlinkSync(canonicalScope, scopeRoot, "dir");
  const resolvedStore = relocated ? join(root, "private-state") : store;
  if (relocated) {
    rmSync(store, { recursive: true });
    mkdirSync(resolvedStore);
    symlinkSync(resolvedStore, store, "dir");
  }
  const transcript = "sibling/retired/generation/transcript.txt";
  const privateContents = "synthetic private conversation context";
  mkdirSync(dirname(join(resolvedStore, transcript)), { recursive: true });
  writeFileSync(join(resolvedStore, transcript), privateContents);
  const dotPrefixedTranscript = join(resolvedStore, "..retired", "transcript.txt");
  mkdirSync(dirname(dotPrefixedTranscript));
  writeFileSync(dotPrefixedTranscript, privateContents);
  symlinkSync(resolvedStore, join(cwd, "notes"), "dir");
  symlinkSync(join(resolvedStore, transcript), join(cwd, "note.txt"));
  const ordinaryFile = join(canonicalScope, "readme.txt");
  writeFileSync(ordinaryFile, "public project context");
  const adjacentFile = join(`${resolvedStore}-public`, "readme.txt");
  mkdirSync(dirname(adjacentFile));
  writeFileSync(adjacentFile, "public project context");

  if (!Array.isArray(filesystemModule.tools)) throw new Error("Expected static filesystem tools");
  for (const name of ["file_read", "grep"]) {
    const definition = filesystemModule.tools.find(({ tool }) => tool.name === name);
    if (!definition) throw new Error(`Missing filesystem tool ${name}`);
    cleanup.push(registerTool(definition.tool, definition.runner, filesystemModule.name, definition));
  }
  const scopePolicy = resolveScopePolicy({
    projection: {
      rootScopeId: "global",
      defaultScopeId: "fixture",
      scopes: [
        { scopeId: "global", displayName: "Global" },
        { scopeId: "fixture", displayName: "Fixture", parentScopeId: "global", directoryRoot: scopeRoot },
      ],
    },
    scopeId: "fixture",
    fragments: [],
  });
  const read = async (path: string) => (await executeToolCalls([
    { type: "tool_use", id: "read", name: "file_read", input: { path } },
  ], {
    autonomyMode: "autonomous", resultLimit: 10000, verbose: false,
    scopeId: "fixture", scopePolicy, cwd, scopeRoot,
  }))[0];

  for (const path of [
    join(store, transcript),
    join(scopeRoot, ".kota/openai-tools-agent-harness/sessions", transcript),
    join(resolvedStore, transcript),
    dotPrefixedTranscript,
    relative(cwd, join(store, transcript)),
    join("notes", transcript),
    "note.txt",
  ]) {
    const result = await read(path);
    expect(result, path).toMatchObject({ is_error: true });
    expect(result.content, path).toContain("access denied for protected scope");
    expect(result.content, path).not.toContain(privateContents);
  }
  for (const path of [canonicalScope, dirname(resolvedStore), cwd, root]) {
    for (const mode of [{ context_lines: 2 }, { files_only: true }, { count_only: true }]) {
      const result = (await executeToolCalls([
        { type: "tool_use", id: "search", name: "grep", input: {
          pattern: "context", path, file_glob: "*.txt", ...mode,
        } },
      ], {
        autonomyMode: "autonomous", resultLimit: 10000, verbose: false,
        scopeId: "fixture", scopePolicy, cwd, scopeRoot,
      }))[0];
      expect(result.is_error, `${path}: ${JSON.stringify(mode)}`).not.toBe(true);
      expect(result.content).not.toContain(privateContents);
      expect(result.content).not.toContain("transcript.txt");
      expect(result.content).not.toContain("note.txt");
      if (path !== cwd) expect(result.content).toContain("readme.txt");
    }
  }
  for (const path of [ordinaryFile, adjacentFile]) {
    const result = await read(path);
    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain("public project context");
  }
});
