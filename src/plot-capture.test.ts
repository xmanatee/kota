import { describe, test, expect, afterEach } from "vitest";
import { extractPlots, readPlotFiles } from "./plot-capture.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("extractPlots", () => {
  test("extracts plot paths from output", () => {
    const output =
      "some output\n__KOTA_PLOT__:/tmp/kota_1.png\nmore output\n__KOTA_PLOT__:/tmp/kota_2.png";
    const { text, plotPaths } = extractPlots(output);
    expect(text).toBe("some output\nmore output");
    expect(plotPaths).toEqual(["/tmp/kota_1.png", "/tmp/kota_2.png"]);
  });

  test("returns empty plotPaths when no markers present", () => {
    const output = "just some output\nno plots here";
    const { text, plotPaths } = extractPlots(output);
    expect(text).toBe("just some output\nno plots here");
    expect(plotPaths).toEqual([]);
  });

  test("handles empty output", () => {
    const { text, plotPaths } = extractPlots("");
    expect(text).toBe("");
    expect(plotPaths).toEqual([]);
  });

  test("handles output with only plot markers", () => {
    const output = "__KOTA_PLOT__:/tmp/a.png\n__KOTA_PLOT__:/tmp/b.png";
    const { text, plotPaths } = extractPlots(output);
    expect(text).toBe("");
    expect(plotPaths).toEqual(["/tmp/a.png", "/tmp/b.png"]);
  });

  test("handles plot marker at end of output", () => {
    const output = "result: 42\n__KOTA_PLOT__:/tmp/fig.png";
    const { text, plotPaths } = extractPlots(output);
    expect(text).toBe("result: 42");
    expect(plotPaths).toEqual(["/tmp/fig.png"]);
  });

  test("handles plot marker at start of output", () => {
    const output = "__KOTA_PLOT__:/tmp/fig.png\nresult: 42";
    const { text, plotPaths } = extractPlots(output);
    expect(text).toBe("result: 42");
    expect(plotPaths).toEqual(["/tmp/fig.png"]);
  });

  test("preserves lines that look similar but aren't markers", () => {
    const output = "__KOTA_PLOT_WRONG:/tmp/fig.png\nreal output";
    const { text, plotPaths } = extractPlots(output);
    expect(text).toBe("__KOTA_PLOT_WRONG:/tmp/fig.png\nreal output");
    expect(plotPaths).toEqual([]);
  });
});

describe("readPlotFiles", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* already cleaned */ }
    }
    tempFiles.length = 0;
  });

  test("reads files as base64 image blocks", () => {
    const path = join(tmpdir(), `kota_test_${Date.now()}.png`);
    writeFileSync(path, "fake-png-data");
    tempFiles.push(path);

    const blocks = readPlotFiles([path]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("image");
    if (blocks[0].type === "image") {
      expect(blocks[0].source.media_type).toBe("image/png");
      expect(blocks[0].source.data).toBe(
        Buffer.from("fake-png-data").toString("base64"),
      );
    }
    // File should be deleted after reading
    expect(existsSync(path)).toBe(false);
  });

  test("returns warning for non-existent files", () => {
    const blocks = readPlotFiles(["/tmp/kota_nonexistent_999.png"]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("text");
    if (blocks[0].type === "text") {
      expect(blocks[0].text).toContain("Warning");
      expect(blocks[0].text).toContain("kota_nonexistent_999.png");
    }
  });

  test("returns images and warning for mix of existing and non-existing files", () => {
    const path = join(tmpdir(), `kota_test_mix_${Date.now()}.png`);
    writeFileSync(path, "data");
    tempFiles.push(path);

    const blocks = readPlotFiles([
      "/tmp/kota_nonexistent_998.png",
      path,
      "/tmp/kota_nonexistent_997.png",
    ]);
    expect(blocks).toHaveLength(2); // 1 image + 1 warning
    expect(blocks[0].type).toBe("image");
    expect(blocks[1].type).toBe("text");
    if (blocks[1].type === "text") {
      expect(blocks[1].text).toContain("2 plot file(s)");
    }
  });

  test("warning includes actionable guidance", () => {
    const blocks = readPlotFiles(["/tmp/kota_missing.png"]);
    const warning = blocks.find(b => b.type === "text");
    expect(warning).toBeDefined();
    if (warning?.type === "text") {
      expect(warning.text).toContain("plt.savefig()");
    }
  });

  test("returns empty array for empty input", () => {
    const blocks = readPlotFiles([]);
    expect(blocks).toEqual([]);
  });

  test("reads multiple files in order", () => {
    const path1 = join(tmpdir(), `kota_test_a_${Date.now()}.png`);
    const path2 = join(tmpdir(), `kota_test_b_${Date.now()}.png`);
    writeFileSync(path1, "data-a");
    writeFileSync(path2, "data-b");
    tempFiles.push(path1, path2);

    const blocks = readPlotFiles([path1, path2]);
    expect(blocks).toHaveLength(2);
    if (blocks[0].type === "image" && blocks[1].type === "image") {
      expect(blocks[0].source.data).toBe(Buffer.from("data-a").toString("base64"));
      expect(blocks[1].source.data).toBe(Buffer.from("data-b").toString("base64"));
    }
  });
});
