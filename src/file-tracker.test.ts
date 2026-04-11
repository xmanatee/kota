import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return { ...actual, statSync: vi.fn() };
});

const mockStat = fs.statSync as ReturnType<typeof vi.fn>;

// Use unique paths per test to avoid shared state interference
let pathCounter = 0;
function uniquePath(): string {
  return `/tmp/tracker-test-${++pathCounter}-${Date.now()}.txt`;
}

beforeEach(() => {
  mockStat.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Dynamic import to get fresh module (shared state isolation via unique paths)
async function getTracker() {
  return await import("./core/file-tracking/file-tracker.js");
}

describe("recordRead", () => {
  it("records mtime for existing file", async () => {
    const { recordRead, checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockReturnValue({ mtimeMs: 1000 });
    recordRead(p);
    // Same mtime → fresh
    expect(checkFreshness(p)).toBeNull();
  });

  it("does nothing for non-existent file", async () => {
    const { recordRead, checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockImplementation(() => { throw new Error("ENOENT"); });
    recordRead(p);
    // Not tracked → null
    expect(checkFreshness(p)).toBeNull();
  });
});

describe("recordModification", () => {
  it("updates tracked mtime to current", async () => {
    const { recordRead, recordModification, checkFreshness } = await getTracker();
    const p = uniquePath();
    // Initial read at t=1000
    mockStat.mockReturnValue({ mtimeMs: 1000 });
    recordRead(p);
    // External modification at t=2000, then we record it
    mockStat.mockReturnValue({ mtimeMs: 2000 });
    recordModification(p);
    // Now tracked at 2000, current is 2000 → fresh
    expect(checkFreshness(p)).toBeNull();
  });
});

describe("checkFreshness", () => {
  it("returns null for untracked file", async () => {
    const { checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockReturnValue({ mtimeMs: 1000 });
    expect(checkFreshness(p)).toBeNull();
  });

  it("returns null when mtime unchanged", async () => {
    const { recordRead, checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockReturnValue({ mtimeMs: 5000 });
    recordRead(p);
    expect(checkFreshness(p)).toBeNull();
  });

  it("returns warning when mtime changed", async () => {
    const { recordRead, checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockReturnValue({ mtimeMs: 1000 });
    recordRead(p);
    // File modified externally
    mockStat.mockReturnValue({ mtimeMs: 2000 });
    const warning = checkFreshness(p);
    expect(warning).not.toBeNull();
    expect(warning).toContain("modified since you last read");
    expect(warning).toContain(p);
  });

  it("returns null when file deleted after tracking", async () => {
    const { recordRead, checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockReturnValue({ mtimeMs: 1000 });
    recordRead(p);
    // File deleted
    mockStat.mockImplementation(() => { throw new Error("ENOENT"); });
    expect(checkFreshness(p)).toBeNull();
  });

  it("updates tracked mtime after warning (no double warn)", async () => {
    const { recordRead, checkFreshness } = await getTracker();
    const p = uniquePath();
    mockStat.mockReturnValue({ mtimeMs: 1000 });
    recordRead(p);
    // File modified externally
    mockStat.mockReturnValue({ mtimeMs: 2000 });
    const first = checkFreshness(p);
    expect(first).not.toBeNull();
    // Second check with same mtime → no warning (mtime was updated)
    const second = checkFreshness(p);
    expect(second).toBeNull();
  });
});
