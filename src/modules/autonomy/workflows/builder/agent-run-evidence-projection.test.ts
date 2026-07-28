import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkAgentRunArtifactsReady,
  commitBuilderWorkflowChanges,
} from "./agent-run-artifacts.js";
import { BUILDER_EVIDENCE_MANIFEST_FILE } from "./agent-run-evidence-manifest.js";

const tempDirs: string[] = [];
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return result;
}

function pngWithCompressedSecret(secret: string): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const compressedMetadata = Buffer.concat([
    Buffer.from("Comment\0\0", "latin1"),
    deflateSync(Buffer.from(secret, "utf8")),
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("zTXt", compressedMetadata),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunkTypes(png: Buffer): string[] {
  const types: string[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    types.push(png.subarray(offset + 4, offset + 8).toString("ascii"));
    offset += 12 + length;
  }
  return types;
}

function initRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "kota-evidence-projection-"));
  tempDirs.push(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  writeFileSync(join(repo, ".gitignore"), "/.kota/*\n", "utf8");
  writeFileSync(join(repo, "seed.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: repo });
  return repo;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("builder evidence projection", () => {
  it("removes compressed PNG metadata before force-staging the durable artifact", () => {
    const repo = initRepo();
    const runId = "run-compressed-metadata";
    const agentRunDir = join(repo, ".kota", "builder-evidence", runId);
    const sourceArtifactDir = join(agentRunDir, "artifacts");
    mkdirSync(sourceArtifactDir, { recursive: true });
    writeFileSync(join(agentRunDir, "success-criteria.txt"), "1. Safe projection\n");
    writeFileSync(
      join(agentRunDir, "success-criteria-verified.txt"),
      "1. Safe projection verified\n",
    );
    writeFileSync(join(agentRunDir, "commit-message.txt"), "Builder: project png\n");
    writeFileSync(
      join(agentRunDir, BUILDER_EVIDENCE_MANIFEST_FILE),
      `${JSON.stringify({
        schemaVersion: 1,
        artifacts: [{ path: "screenshot.png", kind: "png" }],
      })}\n`,
    );
    const secret = "OPENAI_API_KEY=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sourcePng = pngWithCompressedSecret(secret);
    const sourcePath = join(sourceArtifactDir, "screenshot.png");
    writeFileSync(sourcePath, sourcePng);
    writeFileSync(join(repo, "change.txt"), "implementation\n");

    expect(chunkTypes(sourcePng)).toContain("zTXt");
    expect(checkAgentRunArtifactsReady(agentRunDir, repo)).toMatch(/^OK: 5 /);
    commitBuilderWorkflowChanges(repo, agentRunDir);

    const projectedPng = execFileSync(
      "git",
      ["show", `HEAD:.kota/runs/${runId}/evidence/artifacts/screenshot.png`],
      { cwd: repo, encoding: "buffer" },
    );
    expect(chunkTypes(projectedPng)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(projectedPng).not.toEqual(sourcePng);
    expect(readFileSync(sourcePath)).toEqual(sourcePng);
    expect(
      execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }),
    ).not.toContain(".kota/builder-evidence/");
  });
});
