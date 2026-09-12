import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveRunArtifactHandoff, retainRunArtifacts } from "./run-artifact-handoff.js";

const roots: string[] = [];
function fixture() {
  const scopeRoot = mkdtempSync(join(tmpdir(), "kota-artifact-"));
  roots.push(scopeRoot);
  const path = join(scopeRoot, ".kota/runtime/run/artifacts");
  mkdirSync(path, { recursive: true });
  return { scopeRoot, runId: "run-1", roots: [{ name: "artifacts", path }] };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("retains exact binary and structured bytes across restart while separating redacted review hashes", () => {
  const input = fixture();
  const source = input.roots[0]!.path;
  const response = '{"answer":"rendered","password":"do-not-deliver","thinking":"private-plan"}';
  const binary = Buffer.from([0, 255, 1, 2, 3]);
  writeFileSync(join(source, "response.json"), response);
  writeFileSync(join(source, "packet.bin"), binary);
  writeFileSync(join(source, "transcript.txt"), "Operator: report\nKOTA: ready\n");
  writeFileSync(join(source, "events.jsonl"), [
    { type: "text", text: "visible result" },
    { type: "thinking", thinking: "hidden deliberation" },
    { type: "raw", adapter: "provider", payload: { opaque: "hidden provider internals" } },
  ].map(record => JSON.stringify(record)).join("\n"));
  const first = retainRunArtifacts(input);
  const delivered = first.readOnlyPaths.filter(path => path.includes("/projections/")).map(path => readFileSync(path, "utf8")).join("\n");
  expect(delivered).toContain("visible result");
  expect(delivered).not.toContain("hidden deliberation");
  expect(delivered).not.toContain("hidden provider internals");
  expect(retainRunArtifacts(input).manifestSha256).toBe(first.manifestSha256);
  for (const entry of first.manifest.entries) {
    expect(entry.status).toBe("retained");
    if (entry.status !== "retained") throw new Error("expected retained asset");
    expect(first.readOnlyPaths).not.toContain(join(input.scopeRoot, entry.originalRef));
    if (entry.source.endsWith("packet.bin")) {
      expect(readFileSync(join(input.scopeRoot, entry.originalRef))).toEqual(binary);
      expect(entry.projection.status).toBe("unavailable");
    }
    if (entry.source.endsWith("response.json")) {
      expect(entry.originalSha256).toBe(createHash("sha256").update(response).digest("hex"));
      expect(readFileSync(join(input.scopeRoot, entry.originalRef), "utf8")).toBe(response);
      if (entry.projection.status !== "available") throw new Error("expected projection");
      expect(entry.projection.sha256).not.toBe(entry.originalSha256);
      const projection = readFileSync(join(input.scopeRoot, entry.projection.ref), "utf8");
      expect(projection).toContain("rendered");
      expect(projection).not.toContain("do-not-deliver");
      expect(projection).not.toContain("private-plan");
    }
  }
  rmSync(source, { recursive: true });
  expect(resolveRunArtifactHandoff(input.scopeRoot, { runId: input.runId, manifestSha256: first.manifestSha256 })).toEqual(first);
  writeFileSync(first.readOnlyPaths.at(-1)!, "altered");
  expect(() => resolveRunArtifactHandoff(input.scopeRoot, { runId: input.runId, manifestSha256: first.manifestSha256 })).toThrow(/altered/);
});

test.each(["json", "jsonl", "txt"])("preserves source privacy classification for %s review projections", extension => {
  const input = fixture();
  const content = extension === "txt" ? "PRIVATE_DELIBERATION_SENTINEL" : '{"text":"PRIVATE_DELIBERATION_SENTINEL"}\n';
  writeFileSync(join(input.roots[0]!.path, `private-reasoning.${extension}`), content);
  writeFileSync(join(input.roots[0]!.path, `result.${extension}`), content.replace("PRIVATE_DELIBERATION_SENTINEL", "PUBLIC_OUTCOME_SENTINEL"));
  if (extension !== "txt") writeFileSync(join(input.roots[0]!.path, `private-plan.${extension}`), 'PRIVATE_DELIBERATION_SENTINEL { malformed');
  const handoff = retainRunArtifacts(input);
  const delivered = handoff.readOnlyPaths.map(path => readFileSync(path, "utf8")).join("\n");
  expect(delivered).not.toContain("PRIVATE_DELIBERATION_SENTINEL");
  expect(delivered).toContain("PUBLIC_OUTCOME_SENTINEL");
  const entry = handoff.manifest.entries.find(entry => entry.source.endsWith(`private-reasoning.${extension}`));
  if (entry?.status !== "retained") throw new Error("expected retained private original");
  expect(readFileSync(join(input.scopeRoot, entry.originalRef), "utf8")).toBe(content);
  expect(handoff.readOnlyPaths).not.toContain(join(input.scopeRoot, entry.originalRef));
  if (extension !== "txt") expect(handoff.manifest.entries.find(entry => entry.source.endsWith(`private-plan.${extension}`))).toMatchObject({ status: "retained", projection: { status: "unavailable" } });
});

test.each(["symlink", "hardlink", "directory-link"])("keeps %s unavailable to reviewers", kind => {
  const input = fixture();
  const outside = join(input.scopeRoot, "outside");
  mkdirSync(outside);
  const file = join(outside, "value.txt");
  writeFileSync(file, "unapproved");
  const target = join(input.roots[0]!.path, "linked");
  if (kind === "hardlink") linkSync(file, target);
  else symlinkSync(kind === "directory-link" ? outside : file, target);
  const handoff = retainRunArtifacts(input);
  expect(handoff.manifest.entries).toEqual([expect.objectContaining({ status: "unavailable" })]);
  expect(readFileSync(file, "utf8")).toBe("unapproved");
});

test("rejects scope traversal, unavailable manifests and projection overflow without truncating originals", () => {
  const input = fixture();
  const content = "x".repeat(128 * 1024 + 1);
  writeFileSync(join(input.roots[0]!.path, "large.txt"), content);
  const handoff = retainRunArtifacts(input);
  expect(handoff.manifest.entries[0]).toMatchObject({ status: "retained", originalBytes: content.length, projection: { status: "unavailable" } });
  expect(() => resolveRunArtifactHandoff(input.scopeRoot, { runId: "../escape", manifestSha256: handoff.manifestSha256 })).toThrow();
  expect(() => resolveRunArtifactHandoff(input.scopeRoot, { runId: "missing", manifestSha256: handoff.manifestSha256 })).toThrow(/absent/);
  expect(() => retainRunArtifacts({ ...input, roots: [{ name: "outside", path: resolve(input.scopeRoot, "..") }] })).toThrow(/Invalid evidence/);
});
