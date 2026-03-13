import { describe, it, expect } from "vitest";
import { VerifyTracker, isVerifyCommand, detectVerifyCommands } from "./verify-tracker.js";

describe("VerifyTracker", () => {
  it("starts with empty state", () => {
    const tracker = new VerifyTracker();
    expect(tracker.getState()).toBe("");
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("tracks edited files", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    expect(tracker.getUnverifiedCount()).toBe(1);
    expect(tracker.getState()).toContain("src/foo.ts");
  });

  it("tracks multiple edited files", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/bar.ts");
    expect(tracker.getUnverifiedCount()).toBe(2);
    expect(tracker.getState()).toContain("src/foo.ts");
    expect(tracker.getState()).toContain("src/bar.ts");
  });

  it("deduplicates same file edited multiple times", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/foo.ts");
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("ignores empty paths", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("");
    expect(tracker.getUnverifiedCount()).toBe(0);
  });

  it("clears on verification shell command", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.recordEdit("src/bar.ts");
    tracker.checkShellCommand("npm test");
    expect(tracker.getUnverifiedCount()).toBe(0);
    expect(tracker.getState()).toBe("");
  });

  it("does not clear on non-verify shell commands", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.checkShellCommand("git status");
    expect(tracker.getUnverifiedCount()).toBe(1);
  });

  it("shows available verify commands when provided", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
      { label: "typecheck", command: "npm run typecheck" },
    ]);
    tracker.recordEdit("src/foo.ts");
    const state = tracker.getState();
    expect(state).toContain("`npm test`");
    expect(state).toContain("`npm run typecheck`");
  });

  it("limits displayed commands to 3", () => {
    const tracker = new VerifyTracker([
      { label: "test", command: "npm test" },
      { label: "typecheck", command: "npm run typecheck" },
      { label: "lint", command: "npm run lint" },
      { label: "build", command: "npm run build" },
    ]);
    tracker.recordEdit("src/foo.ts");
    const state = tracker.getState();
    expect(state).not.toContain("`npm run build`");
  });

  it("shows nudge after 3 ticks without verification", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.tick();
    tracker.tick();
    expect(tracker.getState()).not.toContain("Consider verifying");
    tracker.tick();
    expect(tracker.getState()).toContain("Consider verifying");
  });

  it("does not tick when no edits are pending", () => {
    const tracker = new VerifyTracker();
    tracker.tick();
    tracker.tick();
    tracker.tick();
    // No edits, so no nudge even after many ticks
    expect(tracker.getState()).toBe("");
  });

  it("resets turn counter on verification", () => {
    const tracker = new VerifyTracker();
    tracker.recordEdit("src/foo.ts");
    tracker.tick();
    tracker.tick();
    tracker.tick();
    expect(tracker.getState()).toContain("Consider verifying");
    tracker.checkShellCommand("npm test");
    expect(tracker.getState()).toBe("");
    // New edit should not immediately nudge
    tracker.recordEdit("src/bar.ts");
    tracker.tick();
    expect(tracker.getState()).not.toContain("Consider verifying");
  });

  it("limits displayed files to 10", () => {
    const tracker = new VerifyTracker();
    for (let i = 0; i < 15; i++) {
      tracker.recordEdit(`src/file-${i}.ts`);
    }
    expect(tracker.getUnverifiedCount()).toBe(15);
    const state = tracker.getState();
    const matches = state.match(/src\/file-/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeLessThanOrEqual(10);
  });
});

describe("isVerifyCommand", () => {
  it("recognizes npm commands", () => {
    expect(isVerifyCommand("npm test")).toBe(true);
    expect(isVerifyCommand("npm run typecheck")).toBe(true);
    expect(isVerifyCommand("npm run lint")).toBe(true);
    expect(isVerifyCommand("npm run build")).toBe(true);
    expect(isVerifyCommand("npm run check")).toBe(true);
  });

  it("recognizes pnpm commands", () => {
    expect(isVerifyCommand("pnpm test")).toBe(true);
    expect(isVerifyCommand("pnpm run typecheck")).toBe(true);
    expect(isVerifyCommand("pnpm lint")).toBe(true);
  });

  it("recognizes yarn commands", () => {
    expect(isVerifyCommand("yarn test")).toBe(true);
    expect(isVerifyCommand("yarn run lint")).toBe(true);
  });

  it("recognizes cargo commands", () => {
    expect(isVerifyCommand("cargo test")).toBe(true);
    expect(isVerifyCommand("cargo check")).toBe(true);
    expect(isVerifyCommand("cargo clippy")).toBe(true);
    expect(isVerifyCommand("cargo build")).toBe(true);
  });

  it("recognizes python commands", () => {
    expect(isVerifyCommand("pytest")).toBe(true);
    expect(isVerifyCommand("pytest tests/")).toBe(true);
    expect(isVerifyCommand("python -m pytest tests/")).toBe(true);
  });

  it("recognizes go commands", () => {
    expect(isVerifyCommand("go test ./...")).toBe(true);
    expect(isVerifyCommand("go vet")).toBe(true);
    expect(isVerifyCommand("go build")).toBe(true);
  });

  it("recognizes make commands", () => {
    expect(isVerifyCommand("make test")).toBe(true);
    expect(isVerifyCommand("make build")).toBe(true);
    expect(isVerifyCommand("make lint")).toBe(true);
  });

  it("recognizes standalone tools", () => {
    expect(isVerifyCommand("tsc --noEmit")).toBe(true);
    expect(isVerifyCommand("vitest run")).toBe(true);
    expect(isVerifyCommand("jest")).toBe(true);
    expect(isVerifyCommand("biome check .")).toBe(true);
    expect(isVerifyCommand("eslint src/")).toBe(true);
  });

  it("rejects non-verify commands", () => {
    expect(isVerifyCommand("git status")).toBe(false);
    expect(isVerifyCommand("ls -la")).toBe(false);
    expect(isVerifyCommand("cat foo.txt")).toBe(false);
    expect(isVerifyCommand("npm install")).toBe(false);
    expect(isVerifyCommand("cd src")).toBe(false);
    expect(isVerifyCommand("echo hello")).toBe(false);
    expect(isVerifyCommand("node script.js")).toBe(false);
  });
});

describe("detectVerifyCommands", () => {
  it("returns empty array for nonexistent directory", () => {
    const commands = detectVerifyCommands("/nonexistent/path/xyz");
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBe(0);
  });

  it("detects commands from current project", () => {
    // This test runs against the actual kota project which has test, typecheck, build
    const commands = detectVerifyCommands(process.cwd());
    expect(commands.length).toBeGreaterThan(0);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain("test");
    expect(labels).toContain("typecheck");
    expect(labels).toContain("build");
  });
});
