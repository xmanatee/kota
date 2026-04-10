import { readFileSync, unlinkSync } from "node:fs";
import type { ToolResultBlock } from "../tools/index.js";

const PLOT_MARKER = "__KOTA_PLOT__:";

/** Parse code_exec output, separating plot file markers from text output. */
export function extractPlots(output: string): { text: string; plotPaths: string[] } {
  const lines = output.split("\n");
  const plotPaths: string[] = [];
  const textLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(PLOT_MARKER)) {
      plotPaths.push(line.slice(PLOT_MARKER.length));
    } else {
      textLines.push(line);
    }
  }

  return { text: textLines.join("\n"), plotPaths };
}

/** Read captured plot image files as base64 blocks. Deletes files after reading.
 *  Returns warning text blocks for files that couldn't be read. */
export function readPlotFiles(paths: string[]): ToolResultBlock[] {
  const blocks: ToolResultBlock[] = [];
  const failed: string[] = [];
  for (const p of paths) {
    try {
      const data = readFileSync(p).toString("base64");
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data },
      });
      unlinkSync(p);
    } catch {
      failed.push(p);
    }
  }
  if (failed.length > 0) {
    blocks.push({
      type: "text",
      text: `Warning: ${failed.length} plot file(s) could not be read: ${failed.join(", ")}. The plot may not have been saved correctly — check that plt.savefig() or plt.show() completed without errors.`,
    });
  }
  return blocks;
}
