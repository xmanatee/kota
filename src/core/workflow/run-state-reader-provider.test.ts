import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunStateDatabase } from "./run-state-database.js";
import { createRunStateReader } from "./run-state-reader-provider.js";

describe("run-state reader capability", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("exposes only frozen bound read operations", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-run-state-reader-"));
    roots.push(root);
    const database = new RunStateDatabase(root);
    database.registerProject({
      id: "project-a",
      rootPath: join(root, "project-a"),
      createdAt: "2026-08-26T10:00:00.000Z",
    });

    const reader = createRunStateReader(database);

    expect(reader.getProjectIdByRootPath(join(root, "project-a"))).toBe("project-a");
    expect(reader.readProjectStateValue("project-a", "missing")).toEqual({
      revision: 0,
      value: null,
    });
    expect(Object.isFrozen(reader)).toBe(true);
    expect("finishRun" in reader).toBe(false);
    expect("admitRun" in reader).toBe(false);
    database.close();
  });
});
