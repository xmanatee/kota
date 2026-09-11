import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { outboundHttpRequestPort } from "#core/outbound-http/testing/request-port.js";
import {
  type InstalledTool,
  installTool,
  listTools,
  loadManifest,
  parseSource,
  removeTool,
  saveManifest,
  updateTool,
} from "./registry.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kota-registry-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const uri = "https://example.com/weather.mjs";
const original = "export default { version: 1 };";
const replacement = "export default { version: 2 };";
const entry: InstalledTool = {
  source: "url", uri, version: "latest", files: ["modules/weather"],
  installedAt: "2026-03-15T00:00:00.000Z",
};
const manifest = { tools: { weather: entry } };
const moduleDir = () => join(root, ".kota", "modules", "weather");
const contentPort = (content: string) => outboundHttpRequestPort(() => new Response(content));
function seed(files = entry.files): void {
  for (const file of files) {
    mkdirSync(join(root, ".kota", file), { recursive: true });
    writeFileSync(join(root, ".kota", file, "index.mjs"), original);
  }
  saveManifest({ tools: { weather: { ...entry, files } } }, root);
}

it.each([
  ["npm:@scope/kota-weather", "npm", "@scope/kota-weather", "weather"],
  ["kota-search", "npm", "kota-search", "search"],
  ["tool-calc", "npm", "tool-calc", "calc"],
  ["npm:@company/my-tool", "npm", "@company/my-tool", "my-tool"],
  ["github:user/kota-tool-calc", "github", "user/kota-tool-calc", "calc"],
  ["github:user/tool-email", "github", "user/tool-email", "email"],
  ["user/my-tool", "github", "user/my-tool", "my-tool"],
  [uri, "url", uri, "weather"],
  ["http://localhost:8080/tool.js", "url", "http://localhost:8080/tool.js", "tool"],
])("resolves source identity: %s", (source, type, identifier, name) => {
  expect(parseSource(source)).toEqual({ type, identifier, name });
});

// Parsing preserves opaque input; this does not claim subprocess injection proof.
it.each(["foo; rm -rf /", "foo`whoami`bar", "foo | cat /etc/passwd"])(
  "preserves an opaque npm identifier: %s", (source) => {
    expect(parseSource(source)).toMatchObject({ type: "npm", identifier: source });
  },
);

it("round-trips and lists installed metadata, creating its storage and completing the atomic write", () => {
  expect(loadManifest(root)).toEqual({ tools: {} });
  expect(listTools(root)).toEqual([]);
  const calc: InstalledTool = { ...entry, source: "npm", uri: "kota-calc", version: "1.0.0" };
  const saved = { tools: { weather: entry, calc } };
  saveManifest(saved, root);
  expect(loadManifest(root)).toEqual(saved);
  expect(listTools(root)).toEqual([{ name: "weather", ...entry }, { name: "calc", ...calc }]);
  expect(readdirSync(join(root, ".kota"))).toEqual(["tools.json"]);
});

it.each([
  ["missing", undefined, undefined, false],
  ["corrupt", "bad json", undefined, false],
  ["invalid shape", "[1,2,3]", undefined, false],
  ["interrupted save", undefined, JSON.stringify(manifest), true],
  ["valid primary over stale temporary", JSON.stringify(manifest), '{"tools":{}}', true],
  ["recover corrupt primary", "bad json", JSON.stringify(manifest), true],
  ["both corrupt", "bad json", "also bad", false],
] as const)("loads the manifest after %s", (_label, primary, temporary, recovered) => {
  mkdirSync(join(root, ".kota"));
  if (primary !== undefined) writeFileSync(join(root, ".kota", "tools.json"), primary);
  if (temporary !== undefined) writeFileSync(join(root, ".kota", "tools.json.tmp"), temporary);
  expect(loadManifest(root)).toEqual(recovered ? manifest : { tools: {} });
});

it.each([true, false])("removes an installation with files present: %s", (present) => {
  seed();
  if (!present) rmSync(moduleDir(), { recursive: true });
  expect(removeTool("weather", root)).toBe(true);
  expect(existsSync(moduleDir())).toBe(false);
  expect(loadManifest(root)).toEqual({ tools: {} });
  expect(removeTool("weather", root)).toBe(false);
});

it("rejects duplicate installation with a removal instruction while preserving existing work", async () => {
  seed();
  await expect(installTool(uri, root, contentPort(replacement))).rejects.toThrow(
    /already installed.*kota tools remove weather/,
  );
  expect(loadManifest(root)).toEqual(manifest);
  expect(readFileSync(join(moduleDir(), "index.mjs"), "utf8")).toBe(original);
});

it.each([
  ["HTTP error", () => new Response("Not Found", { status: 404 }), /Download failed: 404/],
  ["network error", () => { throw new Error("ENOTFOUND"); }, /Download failed for.*ENOTFOUND/],
  ["HTML", () => new Response("<html>export default</html>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }), /HTML instead of JavaScript/],
  ["missing exports", () => new Response("const x = 42;"), /no exports found/],
] as const)("rejects %s without publishing a module or manifest entry", async (_label, response, error) => {
  await expect(installTool(uri, root, outboundHttpRequestPort(response))).rejects.toThrow(error);
  expect(existsSync(join(moduleDir(), "index.mjs"))).toBe(false);
  expect(loadManifest(root)).toEqual({ tools: {} });
});

it.each([original, "module.exports = { version: 1 };"])("installs and records module content: %s", async (content) => {
  expect(await installTool(uri, root, contentPort(content))).toEqual({
    name: "weather", source: "url", files: entry.files,
  });
  expect(readFileSync(join(moduleDir(), "index.mjs"), "utf8")).toBe(content);
  expect(loadManifest(root).tools.weather).toEqual({ ...entry, installedAt: expect.any(String) });
});

it("preserves an untracked module when its destination is occupied", async () => {
  seed();
  saveManifest({ tools: {} }, root);
  await expect(installTool(uri, root, contentPort(replacement))).rejects.toThrow(/already exists in modules/);
  expect(readFileSync(join(moduleDir(), "index.mjs"), "utf8")).toBe(original);
  expect(loadManifest(root)).toEqual({ tools: {} });
});

it("rejects updates of absent installations", async () => {
  await expect(updateTool("weather", root, contentPort(replacement))).rejects.toThrow(/not installed/);
});

it("updates existing files and metadata and removes the old backup", async () => {
  seed();
  expect(await updateTool("weather", root, contentPort(replacement))).toEqual({
    name: "weather", source: "url", files: entry.files,
  });
  expect(readFileSync(join(moduleDir(), "index.mjs"), "utf8")).toBe(replacement);
  expect(loadManifest(root).tools.weather).toEqual({ ...entry, installedAt: expect.any(String) });
  expect(existsSync(`${moduleDir()}.kota-update-bak`)).toBe(false);
});

it("restores original files and metadata after a download fails, leaving no backup", async () => {
  seed();
  const failure = outboundHttpRequestPort(() => { throw new Error("network timeout"); });
  await expect(updateTool("weather", root, failure)).rejects.toThrow(/network timeout/);
  expect(loadManifest(root)).toEqual(manifest);
  expect(readFileSync(join(moduleDir(), "index.mjs"), "utf8")).toBe(original);
  expect(existsSync(`${moduleDir()}.kota-update-bak`)).toBe(false);
});

it("restores the first moved directory and manifest if a later backup rename fails", async () => {
  const files = ["modules/weather", "modules/second"];
  seed(files);
  const blocker = join(root, ".kota", "modules", "second.kota-update-bak");
  mkdirSync(blocker);
  writeFileSync(join(blocker, "owner.txt"), "existing work");
  await expect(updateTool("weather", root, contentPort(replacement))).rejects.toThrow();
  expect(loadManifest(root)).toEqual({ tools: { weather: { ...entry, files } } });
  for (const file of files) {
    expect(readFileSync(join(root, ".kota", file, "index.mjs"), "utf8")).toBe(original);
  }
  expect(existsSync(`${moduleDir()}.kota-update-bak`)).toBe(false);
  expect(readFileSync(join(blocker, "owner.txt"), "utf8")).toBe("existing work");
});
