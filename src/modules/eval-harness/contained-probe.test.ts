import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it } from "vitest";
import { containedEvaluationProfiles, parseContainedEvaluationRequest } from "./contained-evaluation.js";
import { collectProbeSource, receiveProbeSource } from "./contained-probe.js";

const roots: string[] = [];
const root = () => { const path = mkdtempSync(join(tmpdir(), "contained-source-")); roots.push(path); return path; };
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const signal = () => new AbortController().signal;

it("receives large Unicode source across split byte sequences and rejects changed content", async () => {
  const content = "é\ufffd🐙".repeat(10000);
  const files = Array.from({ length: 256 }, (_, index) => ({ path: `unicode/${index}.txt`, content }));
  const sourceDigest = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const source = { files, timeoutMs: 60000, sourceDigest };
  const payload = Buffer.from(JSON.stringify(source));
  function* chunks() {
    // This odd byte stride splits the two-, three- and four-byte characters.
    for (let offset = 0; offset < payload.length; offset += 16381)
      yield payload.subarray(offset, offset + 16381);
  }
  const received = await receiveProbeSource(Readable.from(chunks()));
  expect(received).toEqual(source);
  expect(Buffer.from(JSON.stringify(received)).equals(payload)).toBe(true);
  await expect(receiveProbeSource(Readable.from([JSON.stringify({ ...source, files: [{ path: "unicode/0.txt", content: "altered" }] })])))
    .rejects.toThrow("source digest changed during transfer");
});

it("copies current writer text, records changes, and excludes hidden runtime state", async () => {
  const writer = root();
  mkdirSync(join(writer, "src"));
  const source = "// current writer: \ufeffcafé \ufffd 🐙";
  writeFileSync(join(writer, "src/probe.ts"), source);
  writeFileSync(join(writer, "src/.secret"), "private");
  const before = await collectProbeSource(writer, ["src"], signal());
  expect(before.files).toEqual([{ path: "src/probe.ts", content: source }]);
  writeFileSync(join(writer, "src/probe.ts"), "corrected writer");
  const after = await collectProbeSource(writer, ["src"], signal());
  expect(after.digest).not.toBe(before.digest);
  expect(after.files[0]?.content).toBe("corrected writer");
});

it.each(["leaf-link", "parent-link", "hard-link"])("rejects %s attempts to read outside the writer", async (kind) => {
  const writer = root();
  const outside = root();
  writeFileSync(join(outside, "secret"), "host only");
  if (kind === "parent-link") symlinkSync(outside, join(writer, "src"));
  else {
    mkdirSync(join(writer, "src"));
    (kind === "hard-link" ? linkSync : symlinkSync)(join(outside, "secret"), join(writer, "src/secret"));
  }
  await expect(collectProbeSource(writer, ["src/secret"], signal())).rejects.toThrow();
  expect(readFileSync(join(outside, "secret"), "utf8")).toBe("host only");
});

it("rejects cancelled collection and oversized files before returning source", async () => {
  const writer = root();
  writeFileSync(join(writer, "large.ts"), "x".repeat(1024 * 1024 + 1));
  await expect(collectProbeSource(writer, ["large.ts"], signal())).rejects.toThrow("read limit");
  const abort = new AbortController(); abort.abort(new Error("owner cancelled"));
  await expect(collectProbeSource(writer, ["large.ts"], abort.signal)).rejects.toThrow("owner cancelled");
});

it("authorizes offline host probes while denying source, command, model and scope widening", () => {
  const scope = root();
  const profile = {
    scopeRoots: [scope], timeoutMs: 10000, cpuCores: 1, memoryMB: 512,
    probes: { browser: { command: "pnpm run test:owner src/modules/browser", sourcePaths: ["src", "package.json"] } },
    isolationBackend: { kind: "container", executable: "docker", image: "kota:probe", kotaBinaryPath: "/opt/kota/bin/kota.mjs" },
  };
  const profiles = (value: unknown, selectedScope = scope) => containedEvaluationProfiles(selectedScope, { KOTA_EVAL_CONTAINED_PROFILES: JSON.stringify({ linux: value }) });
  expect(profiles(profile).linux?.probes.browser?.command).toBe(profile.probes.browser.command);
  expect(profiles(profile, root())).toEqual({});
  expect(() => profiles({ ...profile, fixtureIds: ["model-fixture"] })).toThrow("provider-egress");
  for (const sourcePath of ["../outside", "/host", ".kota", "src/.env", "src/node_modules", "src/dist"])
    expect(() => profiles({ ...profile, probes: { bad: { command: "pnpm test", sourcePaths: [sourcePath] } } })).toThrow();
  for (const command of ["sh -c whoami", "pnpm test; whoami", "pnpm kota eval run --fixture model --repeats 1 --keep"])
    expect(() => profiles({ ...profile, probes: { bad: { command, sourcePaths: ["src"] } } })).toThrow();
  const request = { operation: "probe", profile: "linux", probeId: "browser" };
  expect(parseContainedEvaluationRequest(request)).toEqual(request);
  for (const override of [{ command: "sh" }, { sourceRoot: "/host" }, { sourcePaths: ["outside"] }, { image: "other" }, { timeoutMs: 99999 }])
    expect(() => parseContainedEvaluationRequest({ ...request, ...override })).toThrow();
});
