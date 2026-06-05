import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLaunchdPlist,
  buildSystemdUnit,
  getLaunchdPlistPath,
  getSystemdServicePath,
  removeServiceFile,
  writeServiceFile,
} from "./index.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `kota-daemon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("service paths", () => {
  it("uses LaunchAgents for launchd", () => {
    expect(getLaunchdPlistPath()).toBe(
      join(homedir(), "Library", "LaunchAgents", "com.kota.daemon.plist"),
    );
  });

  it("uses the user systemd directory", () => {
    expect(getSystemdServicePath()).toBe(
      join(homedir(), ".config", "systemd", "user", "kota-daemon.service"),
    );
  });
});

const emptyEnvironment = { nodeOptions: undefined, path: undefined };

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

  it("preserves NODE_OPTIONS when installing from the dev runtime", () => {
    const content = buildLaunchdPlist("/my/project", {
      ...emptyEnvironment,
      nodeOptions: "--conditions=source",
    });
    expect(content).toContain("<key>NODE_OPTIONS</key>");
    expect(content).toContain("<string>--conditions=source</string>");
  });

  it("preserves PATH for workflow child processes", () => {
    const content = buildLaunchdPlist("/my/project", {
      ...emptyEnvironment,
      path: "/opt/homebrew/bin:/usr/bin",
    });
    expect(content).toContain("<key>PATH</key>");
    expect(content).toContain("<string>/opt/homebrew/bin:/usr/bin</string>");
  });

  it("omits empty NODE_OPTIONS", () => {
    const content = buildLaunchdPlist("/my/project", { ...emptyEnvironment, nodeOptions: "" });
    expect(content).not.toContain("<key>NODE_OPTIONS</key>");
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
    expect(content).toContain('Environment="KOTA_PROJECT_DIR=/my/project"');
  });

  it("preserves NODE_OPTIONS when installing from the dev runtime", () => {
    const content = buildSystemdUnit("/my/project", {
      ...emptyEnvironment,
      nodeOptions: "--conditions=source",
    });
    expect(content).toContain('Environment="NODE_OPTIONS=--conditions=source"');
  });

  it("preserves PATH for workflow child processes", () => {
    const content = buildSystemdUnit("/my/project", {
      ...emptyEnvironment,
      path: "/opt/homebrew/bin:/usr/bin",
    });
    expect(content).toContain('Environment="PATH=/opt/homebrew/bin:/usr/bin"');
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
  it("launchd install-uninstall round-trip", () => {
    const plistPath = join(testDir, "com.kota.daemon.plist");
    const content = buildLaunchdPlist("/my/project");

    const installErr = writeServiceFile(plistPath, content);
    expect(installErr).toBeNull();
    expect(existsSync(plistPath)).toBe(true);

    const uninstallErr = removeServiceFile(plistPath);
    expect(uninstallErr).toBeNull();
    expect(existsSync(plistPath)).toBe(false);
  });

  it("systemd install-uninstall round-trip", () => {
    const servicePath = join(testDir, "kota-daemon.service");
    const content = buildSystemdUnit("/my/project");

    const installErr = writeServiceFile(servicePath, content);
    expect(installErr).toBeNull();
    expect(existsSync(servicePath)).toBe(true);

    const uninstallErr = removeServiceFile(servicePath);
    expect(uninstallErr).toBeNull();
    expect(existsSync(servicePath)).toBe(false);
  });
});
