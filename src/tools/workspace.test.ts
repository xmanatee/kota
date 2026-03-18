import { afterEach, describe, expect, it } from "vitest";
import { clearAllWorkspaces, listWorkspaces, readAllEntries, readEntry } from "../workspace.js";
import { runWorkspace } from "./workspace.js";

afterEach(() => clearAllWorkspaces());

describe("workspace tool", () => {
  describe("create", () => {
    it("creates a workspace", async () => {
      const r = await runWorkspace({ action: "create", workspace: "research" });
      expect(r.content).toContain("research");
      expect(r.content).toContain("ready");
      expect(r.is_error).toBeUndefined();
    });

    it("errors without name", async () => {
      const r = await runWorkspace({ action: "create" });
      expect(r.is_error).toBe(true);
    });

    it("is idempotent", async () => {
      await runWorkspace({ action: "create", workspace: "ws" });
      await runWorkspace({ action: "write", workspace: "ws", key: "k", value: "v" });
      const r = await runWorkspace({ action: "create", workspace: "ws" });
      expect(r.content).toContain("1 entries");
    });
  });

  describe("write", () => {
    it("writes an entry", async () => {
      const r = await runWorkspace({
        action: "write",
        workspace: "ws",
        key: "finding",
        value: "TypeScript is great",
        author: "agent-1",
      });
      expect(r.content).toContain("Written");
      const entry = readEntry("ws", "finding");
      expect(entry?.value).toBe("TypeScript is great");
      expect(entry?.author).toBe("agent-1");
    });

    it("errors without key", async () => {
      const r = await runWorkspace({ action: "write", workspace: "ws", value: "v" });
      expect(r.is_error).toBe(true);
    });

    it("errors without value", async () => {
      const r = await runWorkspace({ action: "write", workspace: "ws", key: "k" });
      expect(r.is_error).toBe(true);
    });

    it("errors without workspace", async () => {
      const r = await runWorkspace({ action: "write", key: "k", value: "v" });
      expect(r.is_error).toBe(true);
    });
  });

  describe("read", () => {
    it("reads a single entry", async () => {
      await runWorkspace({ action: "write", workspace: "ws", key: "k", value: "hello", author: "a1" });
      const r = await runWorkspace({ action: "read", workspace: "ws", key: "k" });
      expect(r.content).toContain("hello");
      expect(r.content).toContain("a1");
    });

    it("reads all entries when no key", async () => {
      await runWorkspace({ action: "write", workspace: "ws", key: "a", value: "1" });
      await runWorkspace({ action: "write", workspace: "ws", key: "b", value: "2" });
      const r = await runWorkspace({ action: "read", workspace: "ws" });
      expect(r.content).toContain("2 entries");
      expect(r.content).toContain("[a]");
      expect(r.content).toContain("[b]");
    });

    it("errors for missing entry", async () => {
      await runWorkspace({ action: "create", workspace: "ws" });
      const r = await runWorkspace({ action: "read", workspace: "ws", key: "nope" });
      expect(r.is_error).toBe(true);
    });

    it("returns empty message for empty workspace", async () => {
      await runWorkspace({ action: "create", workspace: "ws" });
      const r = await runWorkspace({ action: "read", workspace: "ws" });
      expect(r.content).toContain("empty");
    });

    it("errors without workspace", async () => {
      const r = await runWorkspace({ action: "read" });
      expect(r.is_error).toBe(true);
    });
  });

  describe("list", () => {
    it("lists workspaces", async () => {
      await runWorkspace({ action: "create", workspace: "a" });
      await runWorkspace({ action: "create", workspace: "b" });
      const r = await runWorkspace({ action: "list" });
      expect(r.content).toContain("2 workspace");
      expect(r.content).toContain("a");
      expect(r.content).toContain("b");
    });

    it("shows no workspaces message", async () => {
      const r = await runWorkspace({ action: "list" });
      expect(r.content).toBe("No workspaces.");
    });
  });

  describe("delete", () => {
    it("deletes a workspace", async () => {
      await runWorkspace({ action: "create", workspace: "ws" });
      const r = await runWorkspace({ action: "delete", workspace: "ws" });
      expect(r.content).toContain("Deleted workspace");
      expect(listWorkspaces()).toHaveLength(0);
    });

    it("deletes a single entry", async () => {
      await runWorkspace({ action: "write", workspace: "ws", key: "a", value: "1" });
      await runWorkspace({ action: "write", workspace: "ws", key: "b", value: "2" });
      const r = await runWorkspace({ action: "delete", workspace: "ws", key: "a" });
      expect(r.content).toContain("Deleted entry");
      expect(readAllEntries("ws")).toHaveLength(1);
    });

    it("errors for missing workspace", async () => {
      const r = await runWorkspace({ action: "delete", workspace: "nope" });
      expect(r.is_error).toBe(true);
    });

    it("errors for missing entry", async () => {
      await runWorkspace({ action: "create", workspace: "ws" });
      const r = await runWorkspace({ action: "delete", workspace: "ws", key: "nope" });
      expect(r.is_error).toBe(true);
    });

    it("errors without workspace", async () => {
      const r = await runWorkspace({ action: "delete" });
      expect(r.is_error).toBe(true);
    });
  });

  describe("unknown action", () => {
    it("returns error for invalid action", async () => {
      const r = await runWorkspace({ action: "invalid" });
      expect(r.is_error).toBe(true);
      expect(r.content).toContain("Unknown action");
    });
  });

  describe("multi-agent scenario", () => {
    it("multiple agents write to same workspace", async () => {
      await runWorkspace({ action: "create", workspace: "collab" });
      await runWorkspace({ action: "write", workspace: "collab", key: "perf", value: "Rust wins on speed", author: "perf-agent" });
      await runWorkspace({ action: "write", workspace: "collab", key: "dx", value: "TS wins on DX", author: "dx-agent" });
      await runWorkspace({ action: "write", workspace: "collab", key: "ecosystem", value: "Both have strong ecosystems", author: "eco-agent" });

      const r = await runWorkspace({ action: "read", workspace: "collab" });
      expect(r.content).toContain("3 entries");
      expect(r.content).toContain("perf-agent");
      expect(r.content).toContain("dx-agent");
      expect(r.content).toContain("eco-agent");
    });
  });
});
