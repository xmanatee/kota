import { afterEach, describe, expect, it } from "vitest";
import {
  clearAllWorkspaces,
  createWorkspace,
  deleteEntry,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  readAllEntries,
  readEntry,
  writeEntry,
} from "#core/tools/workspace-store.js";

afterEach(() => clearAllWorkspaces());

describe("WorkspaceStore", () => {
  it("creates a workspace", () => {
    const ws = createWorkspace("research");
    expect(ws.name).toBe("research");
    expect(ws.entries.size).toBe(0);
    expect(ws.createdAt).toBeGreaterThan(0);
  });

  it("returns existing workspace on duplicate create", () => {
    const ws1 = createWorkspace("dup");
    writeEntry("dup", "k", "v");
    const ws2 = createWorkspace("dup");
    expect(ws2).toBe(ws1);
    expect(ws2.entries.size).toBe(1);
  });

  it("gets workspace by name", () => {
    expect(getWorkspace("missing")).toBeUndefined();
    createWorkspace("exists");
    expect(getWorkspace("exists")).toBeDefined();
  });

  it("writes and reads entries", () => {
    writeEntry("ws", "key1", "value1", "agent-a");
    writeEntry("ws", "key2", "value2", "agent-b");

    const e1 = readEntry("ws", "key1");
    expect(e1?.value).toBe("value1");
    expect(e1?.author).toBe("agent-a");

    const e2 = readEntry("ws", "key2");
    expect(e2?.value).toBe("value2");
  });

  it("overwrites entries with same key", () => {
    writeEntry("ws", "k", "old");
    writeEntry("ws", "k", "new", "agent-b");
    expect(readEntry("ws", "k")?.value).toBe("new");
    expect(readEntry("ws", "k")?.author).toBe("agent-b");
  });

  it("auto-creates workspace on write", () => {
    expect(getWorkspace("auto")).toBeUndefined();
    writeEntry("auto", "k", "v");
    expect(getWorkspace("auto")).toBeDefined();
  });

  it("reads all entries sorted by time", () => {
    writeEntry("ws", "b", "2");
    writeEntry("ws", "a", "1");
    const entries = readAllEntries("ws");
    expect(entries).toHaveLength(2);
    expect(entries[0].updatedAt).toBeLessThanOrEqual(entries[1].updatedAt);
  });

  it("returns empty array for missing workspace", () => {
    expect(readAllEntries("nope")).toEqual([]);
  });

  it("returns undefined for missing entry", () => {
    createWorkspace("ws");
    expect(readEntry("ws", "missing")).toBeUndefined();
    expect(readEntry("nope", "k")).toBeUndefined();
  });

  it("deletes an entry", () => {
    writeEntry("ws", "k", "v");
    expect(deleteEntry("ws", "k")).toBe(true);
    expect(readEntry("ws", "k")).toBeUndefined();
    expect(deleteEntry("ws", "k")).toBe(false);
  });

  it("delete entry returns false for missing workspace", () => {
    expect(deleteEntry("nope", "k")).toBe(false);
  });

  it("deletes a workspace", () => {
    createWorkspace("ws");
    expect(deleteWorkspace("ws")).toBe(true);
    expect(getWorkspace("ws")).toBeUndefined();
    expect(deleteWorkspace("ws")).toBe(false);
  });

  it("lists workspaces", () => {
    createWorkspace("a");
    writeEntry("b", "k", "v");
    const list = listWorkspaces();
    expect(list).toHaveLength(2);
    const names = list.map((w) => w.name).sort();
    expect(names).toEqual(["a", "b"]);
    expect(list.find((w) => w.name === "b")?.entryCount).toBe(1);
  });

  it("clears all workspaces", () => {
    createWorkspace("a");
    createWorkspace("b");
    clearAllWorkspaces();
    expect(listWorkspaces()).toHaveLength(0);
  });

  it("supports concurrent writes from multiple agents", () => {
    writeEntry("shared", "finding-1", "TypeScript is fast", "agent-1");
    writeEntry("shared", "finding-2", "Rust is faster", "agent-2");
    writeEntry("shared", "finding-3", "Go is simpler", "agent-3");

    const entries = readAllEntries("shared");
    expect(entries).toHaveLength(3);
    const authors = entries.map((e) => e.author);
    expect(authors).toContain("agent-1");
    expect(authors).toContain("agent-2");
    expect(authors).toContain("agent-3");
  });
});
