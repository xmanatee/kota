import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INDEX_VERSION, indexPathFor, SemanticIndexFile } from "./semantic-index.js";

describe("SemanticIndexFile", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kota-semantic-file-"));
    path = indexPathFor(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("persists the complete index and creates missing parents", () => {
    const file = new SemanticIndexFile(indexPathFor(join(dir, "nested")));
    const index = { version: INDEX_VERSION, model: "m", entries: {
      alpha: { fingerprint: "fp-1", embedding: [0.1, 0.2, 0.3] },
    } };
    file.save(index);
    expect(file.load("m")).toEqual(index);
  });

  it.each(["missing", "model", "version"])("treats %s cache data as a miss", (reason) => {
    if (reason !== "missing") writeFileSync(path, JSON.stringify({
      version: reason === "version" ? INDEX_VERSION + 1 : INDEX_VERSION,
      model: reason === "model" ? "retired-model" : "m",
      entries: { alpha: { fingerprint: "fp", embedding: [1, 2] } },
    }));
    expect(new SemanticIndexFile(path).load("m")).toEqual({ version: INDEX_VERSION, model: "m", entries: {} });
  });

  it("discards malformed entries while retaining valid cache data", () => {
    const good = { fingerprint: "fp", embedding: [1, 2] };
    writeFileSync(path, JSON.stringify({ version: INDEX_VERSION, model: "m", entries: {
      good, noEmbedding: { fingerprint: "fp" }, noFingerprint: { embedding: [3, 4] },
    } }));
    expect(new SemanticIndexFile(path).load("m").entries).toEqual({ good });
  });
});
