import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runReadDocument } from "./read-document.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const execute = execFileSync as ReturnType<typeof vi.fn>;
const exists = existsSync as ReturnType<typeof vi.fn>;
const read = readFileSync as ReturnType<typeof vi.fn>;

describe("read_document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exists.mockReturnValue(true);
  });

  it("rejects absent and missing paths before choosing an extractor", async () => {
    await expect(runReadDocument({})).resolves.toMatchObject({ is_error: true });
    exists.mockReturnValue(false);
    await expect(runReadDocument({ path: "/tmp/missing.pdf" })).resolves.toEqual({
      content: "Error: file not found: /tmp/missing.pdf",
      is_error: true,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves relative paths against the tool invocation scope", async () => {
    const scopeRoot = "/selected/project";
    const filePath = join(scopeRoot, "docs", "scope.html");
    read.mockReturnValue("<html><body>Selected project</body></html>");

    const result = await runReadDocument(
      { path: "docs/scope.html" },
      { cwd: scopeRoot },
    );

    expect(exists).toHaveBeenCalledWith(filePath);
    expect(read).toHaveBeenCalledWith(filePath, "utf-8");
    expect(result.content).toContain("Selected project");
  });

  it("maps PDF page ranges to pdftotext and renders extraction provenance", async () => {
    execute.mockReturnValue("Pages 3-7");
    const result = await runReadDocument({ path: "/tmp/test.pdf", pages: "3-7" });

    expect(execute).toHaveBeenCalledWith(
      "pdftotext",
      ["-f", "3", "-l", "7", "/tmp/test.pdf", "-"],
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(result.content).toBe("[Extracted via pdftotext, 9 chars]\n\nPages 3-7");
  });

  it("falls through the PDF provider chain when the preferred binary fails", async () => {
    execute.mockImplementation((command: string) => {
      if (command === "pdftotext") throw new Error("not installed");
      if (command === "python3") return "Fallback text";
      throw new Error(`unexpected command ${command}`);
    });

    const result = await runReadDocument({ path: "/tmp/test.pdf" });
    expect(result.content).toContain("[Extracted via pdfminer");
    expect(result.content).toContain("Fallback text");
  });

  it("reports extractor exhaustion with the format-specific setup hint", async () => {
    execute.mockImplementation(() => { throw new Error("not installed"); });
    const result = await runReadDocument({ path: "/tmp/test.pdf" });
    expect(result).toMatchObject({ is_error: true });
    expect(result.content).toContain("No extractor available for .pdf files");
    expect(result.content).toContain("poppler");
  });

  it("clips oversized extraction output at the public max_chars boundary", async () => {
    execute.mockReturnValue("A".repeat(100));
    const result = await runReadDocument({ path: "/tmp/test.pdf", max_chars: 50 });
    expect(result.content).toContain("50 chars (truncated)");
    expect(result.content.endsWith("A".repeat(50))).toBe(true);
  });

  it("distinguishes successful empty extraction from provider failure", async () => {
    execute.mockReturnValue("   ");
    const result = await runReadDocument({ path: "/tmp/test.pdf" });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("contains no text");
  });
});
