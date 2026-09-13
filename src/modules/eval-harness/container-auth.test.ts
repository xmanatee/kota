import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { containerAuthIssue, snapshotContainerAuth } from "./container-auth.js";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "eval-auth-test-"));
  directories.push(root);
  const workspace = join(root, "candidate");
  mkdirSync(workspace);
  const auth = { sourceFile: join(root, "login.json"), containerDirectory: "/run/test-login", fileName: "auth.json", locatorEnvKey: "CODEX_HOME" };
  writeFileSync(auth.sourceFile, '{"testCredential":"synthetic-only"}');
  return { root, workspace, auth };
}

describe("adapter-owned contained login", () => {
  it("snapshots only the login file outside the candidate tree with private permissions and cleanup", () => {
    const { root, workspace, auth } = setup();
    writeFileSync(join(root, "unrelated-secret"), "never copy");
    expect(containerAuthIssue(auth)).toBeNull();
    const login = snapshotContainerAuth(auth, workspace);
    const source = login.mount.split("source=")[1]!.split(",target=")[0]!;
    try {
      expect(login.env).toEqual({ CODEX_HOME: "/run/test-login" });
      expect(login.mount).toContain(",readonly");
      expect(source.startsWith(workspace)).toBe(false);
      expect(readdirSync(source)).toEqual(["auth.json"]);
      expect(statSync(source).mode & 0o777).toBe(0o700);
      expect(statSync(join(source, "auth.json")).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(source, "auth.json"), "utf8")).toContain("synthetic-only");
      writeFileSync(auth.sourceFile, "changed host login");
      expect(readFileSync(join(source, "auth.json"), "utf8")).toContain("synthetic-only");
      expect(readdirSync(workspace)).toEqual([]);
    } finally { login.cleanup(); }
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(auth.sourceFile, "utf8")).toBe("changed host login");
  });

  it("rejects absent, empty, non-file, and candidate-controlled login sources", () => {
    const { root, workspace, auth } = setup();
    const candidateAuth = join(workspace, "auth.json");
    writeFileSync(candidateAuth, "candidate content");
    const alias = join(root, "alias");
    symlinkSync(candidateAuth, alias);
    for (const sourceFile of [candidateAuth, alias]) {
      expect(() => snapshotContainerAuth({ ...auth, sourceFile }, workspace)).toThrow(/outside the candidate/);
    }
    expect(containerAuthIssue({ ...auth, sourceFile: join(root, "missing") })).toMatch(/unavailable or unreadable/);
    expect(() => containerAuthIssue({ ...auth, sourceFile: workspace })).toThrow(/nonempty regular/);
    writeFileSync(auth.sourceFile, "");
    expect(() => containerAuthIssue(auth)).toThrow(/nonempty regular/);
    expect(() => containerAuthIssue({ ...auth, containerDirectory: "/candidate" })).toThrow(/Invalid adapter/);
    expect(() => snapshotContainerAuth({ ...auth, containerDirectory: "/candidate" }, workspace)).toThrow(/Invalid adapter/);
  });
});
