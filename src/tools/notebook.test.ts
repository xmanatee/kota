import { describe, it, expect, afterEach } from "vitest";
import { runNotebook, notebookTool } from "./notebook.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function tmpPath(name: string): string {
  return path.join(
    os.tmpdir(),
    `kota-nb-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`,
  );
}

describe("notebook tool", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const p of created) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
    created.length = 0;
  });

  it("has required fields in tool definition", () => {
    expect(notebookTool.name).toBe("notebook");
    expect(notebookTool.input_schema.required).toEqual([
      "action",
      "path",
      "cells",
    ]);
  });

  it("rejects non-.ipynb path", async () => {
    const r = await runNotebook({
      action: "create",
      path: "test.json",
      cells: [{ type: "code", content: "x" }],
    });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain(".ipynb");
  });

  it("rejects empty cells", async () => {
    const r = await runNotebook({
      action: "create",
      path: "t.ipynb",
      cells: [],
    });
    expect(r.is_error).toBe(true);
  });

  it("rejects invalid cell type", async () => {
    const r = await runNotebook({
      action: "create",
      path: "t.ipynb",
      cells: [{ type: "raw" as "code", content: "" }],
    });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("raw");
  });

  it("rejects unknown action", async () => {
    const r = await runNotebook({
      action: "run",
      path: "t.ipynb",
      cells: [{ type: "code", content: "x" }],
    });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("run");
  });

  it("creates valid notebook with python3 kernel", async () => {
    const p = tmpPath("py.ipynb");
    created.push(p);
    const r = await runNotebook({
      action: "create",
      path: p,
      cells: [
        { type: "markdown", content: "# Title" },
        { type: "code", content: "print('hello')" },
      ],
    });
    expect(r.is_error).toBeUndefined();
    expect(r.content).toContain("2 cells");
    const nb = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(nb.nbformat).toBe(4);
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0].cell_type).toBe("markdown");
    expect(nb.cells[1].cell_type).toBe("code");
    expect(nb.cells[1].outputs).toEqual([]);
    expect(nb.cells[1].execution_count).toBeNull();
    expect(nb.metadata.kernelspec.name).toBe("python3");
  });

  it("splits multi-line source correctly", async () => {
    const p = tmpPath("lines.ipynb");
    created.push(p);
    await runNotebook({
      action: "create",
      path: p,
      cells: [{ type: "code", content: "a = 1\nb = 2\nc = 3" }],
    });
    const nb = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(nb.cells[0].source).toEqual(["a = 1\n", "b = 2\n", "c = 3"]);
  });

  it("uses javascript kernel when specified", async () => {
    const p = tmpPath("js.ipynb");
    created.push(p);
    await runNotebook({
      action: "create",
      path: p,
      cells: [{ type: "code", content: "console.log(1)" }],
      kernel: "javascript",
    });
    const nb = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(nb.metadata.kernelspec.name).toBe("javascript");
    expect(nb.metadata.language_info.name).toBe("javascript");
  });

  it("appends cells to existing notebook", async () => {
    const p = tmpPath("append.ipynb");
    created.push(p);
    await runNotebook({
      action: "create",
      path: p,
      cells: [{ type: "markdown", content: "# Start" }],
    });
    const r = await runNotebook({
      action: "add_cells",
      path: p,
      cells: [
        { type: "code", content: "x = 42" },
        { type: "markdown", content: "## Result" },
      ],
    });
    expect(r.is_error).toBeUndefined();
    expect(r.content).toContain("total: 3");
    const nb = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(nb.cells).toHaveLength(3);
    expect(nb.cells[2].cell_type).toBe("markdown");
  });

  it("returns error for add_cells on missing file", async () => {
    const r = await runNotebook({
      action: "add_cells",
      path: "/tmp/kota-nonexistent-xyz.ipynb",
      cells: [{ type: "code", content: "x" }],
    });
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("not found");
  });

  it("handles single-line content without trailing newline", async () => {
    const p = tmpPath("single.ipynb");
    created.push(p);
    await runNotebook({
      action: "create",
      path: p,
      cells: [{ type: "code", content: "x = 1" }],
    });
    const nb = JSON.parse(fs.readFileSync(p, "utf-8"));
    expect(nb.cells[0].source).toEqual(["x = 1"]);
  });
});
