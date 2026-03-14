import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runFileRead } from "./file-read.js";

const TEST_DIR = join(process.cwd(), ".test-file-read");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("file_read: text files", () => {
  it("reads a text file with line numbers", async () => {
    const path = join(TEST_DIR, "hello.txt");
    writeFileSync(path, "line1\nline2\nline3");
    const result = await runFileRead({ path });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line2");
    expect(result.blocks).toBeUndefined();
  });

  it("respects offset and limit", async () => {
    const path = join(TEST_DIR, "lines.txt");
    writeFileSync(path, "a\nb\nc\nd\ne");
    const result = await runFileRead({ path, offset: 2, limit: 2 });
    expect(result.content).toContain("b");
    expect(result.content).toContain("c");
    expect(result.content).not.toContain("\td\n");
  });

  it("returns error for missing file", async () => {
    const result = await runFileRead({ path: join(TEST_DIR, "nope.txt") });
    expect(result.is_error).toBe(true);
  });

  it("returns error when path is empty", async () => {
    const result = await runFileRead({ path: "" });
    expect(result.is_error).toBe(true);
  });
});

// Create a minimal 1x1 PNG (68 bytes)
const MINIMAL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );

// Create a minimal 1x1 JPEG
const MINIMAL_JPEG = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=",
    "base64",
  );

describe("file_read: image files", () => {
  it("reads PNG as image with blocks", async () => {
    const path = join(TEST_DIR, "test.png");
    writeFileSync(path, MINIMAL_PNG);
    const result = await runFileRead({ path });

    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("Image:");
    expect(result.content).toContain("test.png");
    expect(result.blocks).toBeDefined();
    expect(result.blocks!.length).toBe(2);

    const imageBlock = result.blocks![0];
    expect(imageBlock.type).toBe("image");
    if (imageBlock.type === "image") {
      expect(imageBlock.source.media_type).toBe("image/png");
      expect(imageBlock.source.type).toBe("base64");
      expect(imageBlock.source.data.length).toBeGreaterThan(0);
    }

    const textBlock = result.blocks![1];
    expect(textBlock.type).toBe("text");
    if (textBlock.type === "text") {
      expect(textBlock.text).toContain("test.png");
    }
  });

  it("reads JPEG as image with blocks", async () => {
    const path = join(TEST_DIR, "photo.jpg");
    writeFileSync(path, MINIMAL_JPEG);
    const result = await runFileRead({ path });

    expect(result.is_error).toBeUndefined();
    expect(result.blocks).toBeDefined();
    const imageBlock = result.blocks![0];
    if (imageBlock.type === "image") {
      expect(imageBlock.source.media_type).toBe("image/jpeg");
    }
  });

  it("reads .jpeg extension correctly", async () => {
    const path = join(TEST_DIR, "photo.jpeg");
    writeFileSync(path, MINIMAL_JPEG);
    const result = await runFileRead({ path });

    expect(result.blocks).toBeDefined();
    const imageBlock = result.blocks![0];
    if (imageBlock.type === "image") {
      expect(imageBlock.source.media_type).toBe("image/jpeg");
    }
  });

  it("reads WebP as image", async () => {
    // Minimal WebP file header (RIFF + WEBP)
    const webpHeader = Buffer.from("RIFF\x00\x00\x00\x00WEBP", "ascii");
    const path = join(TEST_DIR, "img.webp");
    writeFileSync(path, webpHeader);
    const result = await runFileRead({ path });

    expect(result.blocks).toBeDefined();
    const imageBlock = result.blocks![0];
    if (imageBlock.type === "image") {
      expect(imageBlock.source.media_type).toBe("image/webp");
    }
  });

  it("reads GIF as image", async () => {
    // Minimal GIF89a header
    const gifData = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "ascii");
    const path = join(TEST_DIR, "anim.gif");
    writeFileSync(path, gifData);
    const result = await runFileRead({ path });

    expect(result.blocks).toBeDefined();
    const imageBlock = result.blocks![0];
    if (imageBlock.type === "image") {
      expect(imageBlock.source.media_type).toBe("image/gif");
    }
  });

  it("rejects empty image files", async () => {
    const path = join(TEST_DIR, "empty.png");
    writeFileSync(path, Buffer.alloc(0));
    const result = await runFileRead({ path });

    expect(result.is_error).toBe(true);
    expect(result.content).toContain("empty");
  });

  it("ignores offset/limit for images (returns full image)", async () => {
    const path = join(TEST_DIR, "with-offset.png");
    writeFileSync(path, MINIMAL_PNG);
    const result = await runFileRead({ path, offset: 5, limit: 10 });

    // Should still return the full image, not try to do line-based reading
    expect(result.blocks).toBeDefined();
    expect(result.blocks![0].type).toBe("image");
  });

  it("returns content string even for images (for pruning/compaction)", async () => {
    const path = join(TEST_DIR, "meta.png");
    writeFileSync(path, MINIMAL_PNG);
    const result = await runFileRead({ path });

    // content should always be a string (for pruning/compaction/truncation)
    expect(typeof result.content).toBe("string");
    expect(result.content).toContain("Image:");
  });

  it("treats non-image extensions as text", async () => {
    const path = join(TEST_DIR, "data.csv");
    writeFileSync(path, "a,b,c\n1,2,3");
    const result = await runFileRead({ path });

    expect(result.blocks).toBeUndefined();
    expect(result.content).toContain("a,b,c");
  });

  it("treats .svg as text (not image)", async () => {
    const path = join(TEST_DIR, "icon.svg");
    writeFileSync(path, '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
    const result = await runFileRead({ path });

    expect(result.blocks).toBeUndefined();
    expect(result.content).toContain("<svg");
  });
});

describe("file_read: image size formatting", () => {
  it("shows size in content description", async () => {
    const path = join(TEST_DIR, "sized.png");
    writeFileSync(path, MINIMAL_PNG);
    const result = await runFileRead({ path });
    // Should show size like "68B" or similar
    expect(result.content).toMatch(/Image:.*\(\d+(\.\d+)?(B|KB|MB)\)/);
  });
});

describe("file_read: PDF files", () => {
  it("returns error for empty PDF file", async () => {
    const path = join(TEST_DIR, "empty.pdf");
    writeFileSync(path, Buffer.alloc(0));
    const result = await runFileRead({ path });
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("empty");
  });

  it("treats .pdf files as PDF (not raw text)", async () => {
    const path = join(TEST_DIR, "doc.pdf");
    writeFileSync(path, "%PDF-1.4 fake content here");
    const result = await runFileRead({ path });
    // Should enter PDF code path — either extract text, report no text,
    // or error about pdftotext. Never return raw content with line numbers.
    const c = result.content;
    expect(
      c.includes("[PDF:") ||
      c.includes("pdftotext") ||
      c.includes("Error reading PDF") ||
      c.includes("no extractable text"),
    ).toBe(true);
  });

  it("handles .PDF extension case-insensitively", async () => {
    const path = join(TEST_DIR, "UPPER.PDF");
    writeFileSync(path, "%PDF-1.4 uppercase extension");
    const result = await runFileRead({ path });
    const c = result.content;
    expect(
      c.includes("[PDF:") ||
      c.includes("pdftotext") ||
      c.includes("Error reading PDF") ||
      c.includes("no extractable text"),
    ).toBe(true);
  });

  it("returns error for missing PDF file", async () => {
    const result = await runFileRead({ path: join(TEST_DIR, "missing.pdf") });
    expect(result.is_error).toBe(true);
  });
});
