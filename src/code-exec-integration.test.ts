import { beforeEach, describe, expect, it, } from "vitest";
import { extractPlots, readPlotFiles } from "./plot-capture.js";
import { detectToolGroups, enableGroup, getActiveToolNames, resetGroups } from "./tool-groups.js";
import { detectPackageHint, extractMissingPackage } from "./tools/code-exec.js";

/**
 * Cross-module integration tests for the data analysis pipeline:
 *   tool-groups (detection) → code_exec (execution) → plot-capture (visualization)
 *
 * Tests exercise boundaries between modules where data transforms,
 * errors propagate, or formats change.
 */
describe("data analysis pipeline integration", () => {
  beforeEach(() => {
    resetGroups();
  });

  describe("tool-groups → code_exec availability", () => {
    it("'analyze sales data and plot trends' enables code_exec", () => {
      const groups = detectToolGroups("Analyze the sales data and plot monthly trends");
      expect(groups).toContain("code");
      for (const g of groups) enableGroup(g);
      expect(getActiveToolNames().has("code_exec")).toBe(true);
    });

    it("'visualize the distribution' enables code_exec", () => {
      const groups = detectToolGroups("Visualize the distribution of response times");
      expect(groups).toContain("code");
      for (const g of groups) enableGroup(g);
      expect(getActiveToolNames().has("code_exec")).toBe(true);
    });

    it("'create a statistical summary' enables code_exec", () => {
      const groups = detectToolGroups("Create a statistical summary of the dataset");
      expect(groups).toContain("code");
      for (const g of groups) enableGroup(g);
      expect(getActiveToolNames().has("code_exec")).toBe(true);
    });
  });

  describe("code_exec output → plot-capture parsing", () => {
    it("separates plot markers from normal output", () => {
      const output = [
        "Mean: 42.5",
        "Std: 12.3",
        "__KOTA_PLOT__:/tmp/plot_1.png",
        "__KOTA_PLOT__:/tmp/plot_2.png",
        "Done.",
      ].join("\n");
      const { text, plotPaths } = extractPlots(output);
      expect(text).toBe("Mean: 42.5\nStd: 12.3\nDone.");
      expect(plotPaths).toEqual(["/tmp/plot_1.png", "/tmp/plot_2.png"]);
    });

    it("handles output with no plots gracefully", () => {
      const output = "Result: 42\nNo plots generated";
      const { text, plotPaths } = extractPlots(output);
      expect(text).toBe(output);
      expect(plotPaths).toEqual([]);
    });

    it("handles empty output", () => {
      const { text, plotPaths } = extractPlots("");
      expect(text).toBe("");
      expect(plotPaths).toEqual([]);
    });

    it("handles output that is only plot markers", () => {
      const output = "__KOTA_PLOT__:/tmp/p1.png\n__KOTA_PLOT__:/tmp/p2.png";
      const { text, plotPaths } = extractPlots(output);
      expect(text.trim()).toBe("");
      expect(plotPaths).toHaveLength(2);
    });
  });

  describe("plot-capture → tool result (file read errors)", () => {
    it("returns warning block for nonexistent plot files", () => {
      const blocks = readPlotFiles(["/tmp/nonexistent_plot_abc123.png"]);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe("text");
      if (blocks[0].type === "text") {
        expect(blocks[0].text).toContain("Warning");
        expect(blocks[0].text).toContain("nonexistent_plot_abc123.png");
      }
    });

    it("returns empty blocks for empty path array", () => {
      const blocks = readPlotFiles([]);
      expect(blocks).toEqual([]);
    });

    it("end-to-end: plot markers extracted but files missing triggers warning in result", () => {
      // Simulates: code_exec output has plot markers, but files don't exist
      const output = "Computation done\n__KOTA_PLOT__:/tmp/kota_vanished_1.png\n__KOTA_PLOT__:/tmp/kota_vanished_2.png";
      const { text, plotPaths } = extractPlots(output);
      expect(text).toBe("Computation done");
      expect(plotPaths).toHaveLength(2);

      const blocks = readPlotFiles(plotPaths);
      // Should have a warning, not empty
      expect(blocks.length).toBeGreaterThan(0);
      const warning = blocks.find(b => b.type === "text");
      expect(warning).toBeDefined();
      if (warning?.type === "text") {
        expect(warning.text).toContain("2 plot file(s)");
        expect(warning.text).toContain("plt.savefig()");
      }
    });
  });

  describe("code_exec error → package hint flow", () => {
    it("Python ModuleNotFoundError produces install hint", () => {
      const output = "Traceback (most recent call last):\n  File...\nModuleNotFoundError: No module named 'pandas'";
      const hint = detectPackageHint(output, "python");
      expect(hint).toContain("pip install pandas");
    });

    it("Node Cannot find module produces install hint", () => {
      const output = "Error: Cannot find module 'lodash'";
      const hint = detectPackageHint(output, "node");
      expect(hint).toContain("npm install lodash");
    });

    it("extractMissingPackage feeds into detectPackageHint consistently", () => {
      const output = "ModuleNotFoundError: No module named 'seaborn'";
      const pkg = extractMissingPackage(output, "python");
      expect(pkg).toBe("seaborn");
      const hint = detectPackageHint(output, "python");
      expect(hint).toContain("seaborn");
    });

    it("relative module paths do not produce install hints for node", () => {
      const output = "Error: Cannot find module './local-file'";
      const hint = detectPackageHint(output, "node");
      expect(hint).toBeNull();
      const pkg = extractMissingPackage(output, "node");
      expect(pkg).toBeNull();
    });

    it("dotted Python packages extract the root package", () => {
      const output = "ModuleNotFoundError: No module named 'sklearn.ensemble'";
      const pkg = extractMissingPackage(output, "python");
      expect(pkg).toBe("sklearn");
      const hint = detectPackageHint(output, "python");
      expect(hint).toContain("sklearn");
    });
  });
});
