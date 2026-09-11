import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import {
  getNpmVersion,
  installGithub,
  installNpm,
  installUrl,
  resolveInstalledPackageName,
  resolveNpmEntry,
} from "./registry-installers.js";
import { parseSource } from "./registry-source.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-installers-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it.each([
  ["https://example.com/path/to/weather.js", "weather"],
  ["https://example.com/weather.mjs", "weather"],
  ["https://example.com/tool.ts", "tool"],
  ["https://example.com/api/module", "module"],
  ["https://example.com/tool.js?v=2&token=abc", "tool"],
  ["https://example.com/tool.mjs#section", "tool"],
  ["https://example.com/", "tool"],
  ["https://example.com", "tool"],
])("installs the parsed URL at the discoverable module path: %s", async (url, name) => {
  const content = "export default {};";
  const result = await installUrl(parseSource(url), root,
    outboundHttpRequestPort(() => new Response(content)));
  expect(result).toEqual({ name, source: "url", files: [`modules/${name}`] });
  expect(readFileSync(join(root, "modules", name, "index.mjs"), "utf8")).toBe(content);
});

it.each(["", ".", "..", "../escape", "/escape", "a\\b", "a\0b", "\ud800"])(
  "rejects unsafe module identity before installer effects: %j", async (name) => {
    const parsed = { type: "npm", identifier: "unused", name } as const;
    for (const install of [installNpm, installGithub, installUrl]) {
      await expect(install(parsed, root)).rejects.toThrow("Invalid module name");
    }
    expect(readdirSync(root)).toEqual([]);
  },
);

it.each([
  ["version", '{"name":"my-tool","version":"2.3.1"}', "2.3.1"],
  ["missing file", undefined, "unknown"],
  ["missing version", '{"name":"my-tool"}', "unknown"],
  ["corrupt file", "not-json", "unknown"],
] as const)("reads package version: %s", (_label, content, expected) => {
  if (content !== undefined) writeFileSync(join(root, "package.json"), content);
  expect(getNpmVersion(root)).toBe(expected);
});

it.each([
  ["GitHub spec", '{"dependencies":{"cool-tool":"github:user/my-repo"}}', "user/my-repo", "cool-tool"],
  ["unprefixed spec", '{"dependencies":{"actual-name":"user/my-tool#main"}}', "user/my-tool", "actual-name"],
  ["same name", '{"dependencies":{"my-tool":"github:user/my-tool"}}', "user/my-tool", "my-tool"],
  ["unrelated dependency", '{"dependencies":{"other-pkg":"1.0.0"}}', "user/my-tool", "my-tool"],
  ["missing dependencies", '{"name":"kota-ext"}', "user/my-tool", "my-tool"],
  ["missing file", undefined, "user/my-tool", "my-tool"],
  ["corrupt file", "not-json", "user/my-tool", "my-tool"],
] as const)("resolves installed package identity: %s", (_label, content, identifier, expected) => {
  if (content !== undefined) writeFileSync(join(root, "package.json"), content);
  expect(resolveInstalledPackageName(root, identifier)).toBe(expected);
});

it.each([
  ["main", '{"main":"dist/index.js"}', "dist/index.js"],
  ["exports precedes main", '{"exports":{".":"./dist/index.js"},"main":"old.js"}', "./dist/index.js"],
  ["implicit entry", '{"name":"my-pkg"}', "index.js"],
  ["missing file", undefined, null],
] as const)("resolves the package entry: %s", (_label, content, expected) => {
  if (content !== undefined) writeFileSync(join(root, "package.json"), content);
  expect(resolveNpmEntry(root)).toBe(expected);
});
