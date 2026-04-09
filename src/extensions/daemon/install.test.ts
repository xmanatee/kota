import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  removeServiceFile,
  writeServiceFile,
} from "./index.js";

// Temp dir isolated per test to avoid cross-test interference
let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `kota-daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  // Clean up any files written during the test
  try {
    const { rmSync } = require("node:fs");
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("buildLaunchdPlist structural assertions", () => {
  it("contains Label key with com.kota.daemon", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>Label</key>");
    expect(content).toContain("<string>com.kota.daemon</string>");
  });

  it("contains ProgramArguments key", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>ProgramArguments</key>");
    expect(content).toContain("<array>");
  });

  it("contains EnvironmentVariables with KOTA_PROJECT_DIR", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>EnvironmentVariables</key>");
    expect(content).toContain("<key>KOTA_PROJECT_DIR</key>");
    expect(content).toContain("<string>/my/project</string>");
  });

  it("contains StandardOutPath pointing to .kota/daemon.log", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>StandardOutPath</key>");
    expect(content).toContain("<string>/my/project/.kota/daemon.log</string>");
  });

  it("contains StandardErrorPath pointing to .kota/daemon.err", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>StandardErrorPath</key>");
    expect(content).toContain("<string>/my/project/.kota/daemon.err</string>");
  });

  it("contains RunAtLoad set to true", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>RunAtLoad</key>");
    expect(content).toContain("<true/>");
  });

  it("contains KeepAlive set to true", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>KeepAlive</key>");
  });

  it("contains WorkingDirectory set to project dir", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain("<key>WorkingDirectory</key>");
    expect(content).toContain("<string>/my/project</string>");
  });

  it("is valid XML plist with correct declaration", () => {
    const content = buildLaunchdPlist("/my/project");
    expect(content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(content).toContain("<plist version=\"1.0\">");
    expect(content).toContain("</plist>");
  });
});

describe("buildSystemdUnit structural assertions", () => {
  it("contains [Unit] section with After=default.target", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("[Unit]");
    expect(content).toContain("After=default.target");
  });

  it("contains [Service] section", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("[Service]");
  });

  it("contains ExecStart with project binary", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("ExecStart=");
    expect(content).toMatch(/ExecStart=.+ daemon/);
  });

  it("contains Environment= with KOTA_PROJECT_DIR", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("Environment=KOTA_PROJECT_DIR=/my/project");
  });

  it("contains Restart=on-failure", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("Restart=on-failure");
  });

  it("contains StandardOutput=journal", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("StandardOutput=journal");
  });

  it("contains StandardError=journal", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("StandardError=journal");
  });

  it("contains WorkingDirectory set to project dir", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("WorkingDirectory=/my/project");
  });

  it("contains [Install] section with WantedBy=default.target", () => {
    const content = buildSystemdUnit("/my/project");
    expect(content).toContain("[Install]");
    expect(content).toContain("WantedBy=default.target");
  });
});

describe("writeServiceFile", () => {
  it("writes the file and returns null on first write", () => {
    const filePath = join(testDir, "test.plist");
    const err = writeServiceFile(filePath, "content");
    expect(err).toBeNull();
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf8")).toBe("content");
  });

  it("creates parent directories automatically", () => {
    const filePath = join(testDir, "nested", "deep", "test.plist");
    const err = writeServiceFile(filePath, "data");
    expect(err).toBeNull();
    expect(existsSync(filePath)).toBe(true);
  });

  it("returns an error message when file already exists (already installed)", () => {
    const filePath = join(testDir, "test.plist");
    writeServiceFile(filePath, "content");
    const err = writeServiceFile(filePath, "content");
    expect(err).not.toBeNull();
    expect(err).toContain("already installed");
  });

  it("does not overwrite an existing file", () => {
    const filePath = join(testDir, "test.plist");
    writeServiceFile(filePath, "original");
    writeServiceFile(filePath, "replacement");
    expect(readFileSync(filePath, "utf8")).toBe("original");
  });
});

describe("removeServiceFile", () => {
  it("removes the file and returns null when file exists", () => {
    const filePath = join(testDir, "test.plist");
    writeServiceFile(filePath, "content");
    const err = removeServiceFile(filePath);
    expect(err).toBeNull();
    expect(existsSync(filePath)).toBe(false);
  });

  it("returns an error message when file does not exist (not installed)", () => {
    const filePath = join(testDir, "nonexistent.plist");
    const err = removeServiceFile(filePath);
    expect(err).not.toBeNull();
    expect(err).toContain("No KOTA daemon service found");
  });
});

describe("install/uninstall lifecycle", () => {
  it("launchd: full install → uninstall round-trip", () => {
    const plistPath = join(testDir, "com.kota.daemon.plist");
    const content = buildLaunchdPlist("/my/project");

    const installErr = writeServiceFile(plistPath, content);
    expect(installErr).toBeNull();
    expect(existsSync(plistPath)).toBe(true);

    const uninstallErr = removeServiceFile(plistPath);
    expect(uninstallErr).toBeNull();
    expect(existsSync(plistPath)).toBe(false);
  });

  it("launchd: second install returns 'already installed' error", () => {
    const plistPath = join(testDir, "com.kota.daemon.plist");
    const content = buildLaunchdPlist("/my/project");
    writeServiceFile(plistPath, content);

    const err = writeServiceFile(plistPath, content);
    expect(err).not.toBeNull();
    expect(err).toContain("already installed");
  });

  it("launchd: second uninstall returns 'not installed' error", () => {
    const plistPath = join(testDir, "com.kota.daemon.plist");
    const content = buildLaunchdPlist("/my/project");
    writeServiceFile(plistPath, content);
    removeServiceFile(plistPath);

    const err = removeServiceFile(plistPath);
    expect(err).not.toBeNull();
    expect(err).toContain("No KOTA daemon service found");
  });

  it("systemd: full install → uninstall round-trip", () => {
    const servicePath = join(testDir, "kota-daemon.service");
    const content = buildSystemdUnit("/my/project");

    const installErr = writeServiceFile(servicePath, content);
    expect(installErr).toBeNull();
    expect(existsSync(servicePath)).toBe(true);

    const uninstallErr = removeServiceFile(servicePath);
    expect(uninstallErr).toBeNull();
    expect(existsSync(servicePath)).toBe(false);
  });

  it("systemd: second install returns 'already installed' error", () => {
    const servicePath = join(testDir, "kota-daemon.service");
    const content = buildSystemdUnit("/my/project");
    writeServiceFile(servicePath, content);

    const err = writeServiceFile(servicePath, content);
    expect(err).not.toBeNull();
    expect(err).toContain("already installed");
  });

  it("systemd: second uninstall returns 'not installed' error", () => {
    const servicePath = join(testDir, "kota-daemon.service");
    const content = buildSystemdUnit("/my/project");
    writeServiceFile(servicePath, content);
    removeServiceFile(servicePath);

    const err = removeServiceFile(servicePath);
    expect(err).not.toBeNull();
    expect(err).toContain("No KOTA daemon service found");
  });

  it("install writes correct launchd plist content to disk", () => {
    const plistPath = join(testDir, "com.kota.daemon.plist");
    const content = buildLaunchdPlist("/my/project");
    writeServiceFile(plistPath, content);

    const written = readFileSync(plistPath, "utf8");
    expect(written).toContain("<key>Label</key>");
    expect(written).toContain("<string>com.kota.daemon</string>");
    expect(written).toContain("<key>KOTA_PROJECT_DIR</key>");
    expect(written).toContain("<string>/my/project</string>");
    expect(written).toContain("<key>StandardOutPath</key>");
    expect(written).toContain("<key>StandardErrorPath</key>");
    expect(written).toContain("<key>RunAtLoad</key>");
  });

  it("install writes correct systemd unit content to disk", () => {
    const servicePath = join(testDir, "kota-daemon.service");
    const content = buildSystemdUnit("/my/project");
    writeServiceFile(servicePath, content);

    const written = readFileSync(servicePath, "utf8");
    expect(written).toContain("[Unit]");
    expect(written).toContain("[Service]");
    expect(written).toContain("Environment=KOTA_PROJECT_DIR=/my/project");
    expect(written).toContain("Restart=on-failure");
    expect(written).toContain("StandardOutput=journal");
    expect(written).toContain("StandardError=journal");
    expect(written).toContain("[Install]");
    expect(written).toContain("WantedBy=default.target");
  });
});
