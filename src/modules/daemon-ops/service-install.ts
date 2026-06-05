/**
 * Filesystem-only helpers for the OS-managed daemon service.
 *
 * Imported by the local-side `daemonOps.status` handler so it can report
 * whether a launchd plist or systemd unit is installed without forcing
 * the CLI handler to read the operator filesystem directly.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LAUNCHD_LABEL = "com.kota.daemon";
const SYSTEMD_SERVICE = "kota-daemon.service";

export const SERVICE_LABEL_LAUNCHD = LAUNCHD_LABEL;
export const SERVICE_NAME_SYSTEMD = SYSTEMD_SERVICE;

export function getLaunchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function getSystemdServicePath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_SERVICE);
}

export function isServiceInstalled(): boolean {
  if (process.platform === "darwin") {
    return existsSync(getLaunchdPlistPath());
  }
  if (process.platform === "linux") {
    return existsSync(getSystemdServicePath());
  }
  return false;
}

function plistString(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdEnvironment(name: string, value: string): string {
  const escaped = `${name}=${value}`.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  return `Environment="${escaped}"`;
}

type ServiceUnitOptions = {
  nodeOptions?: string;
};

function serviceNodeOptions(options?: ServiceUnitOptions): string | undefined {
  const nodeOptions = options?.nodeOptions ?? process.env.NODE_OPTIONS;
  return nodeOptions && nodeOptions.trim() ? nodeOptions : undefined;
}

export function buildLaunchdPlist(projectDir: string, options?: ServiceUnitOptions): string {
  const kotaBin = process.argv[1]!;
  const logDir = join(projectDir, ".kota");
  const nodeOptions = serviceNodeOptions(options);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${LAUNCHD_LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    <string>${process.execPath}</string>`,
    ...(process.execArgv.map((arg) => `    <string>${arg}</string>`)),
    `    <string>${kotaBin}</string>`,
    `    <string>daemon</string>`,
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>KOTA_PROJECT_DIR</key>`,
    `    <string>${plistString(projectDir)}</string>`,
    ...(nodeOptions
      ? [
          `    <key>NODE_OPTIONS</key>`,
          `    <string>${plistString(nodeOptions)}</string>`,
        ]
      : []),
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  <string>${plistString(projectDir)}</string>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${plistString(`${logDir}/daemon.log`)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${plistString(`${logDir}/daemon.err`)}</string>`,
    `</dict>`,
    `</plist>`,
  ].join("\n");
}

export function buildSystemdUnit(projectDir: string, options?: ServiceUnitOptions): string {
  const kotaBin = process.argv[1]!;
  const execArgs = [...process.execArgv, kotaBin, "daemon"].join(" ");
  const nodeOptions = serviceNodeOptions(options);
  return [
    `[Unit]`,
    `Description=KOTA Daemon`,
    `After=default.target`,
    ``,
    `[Service]`,
    `Type=simple`,
    `ExecStart=${process.execPath} ${execArgs}`,
    `WorkingDirectory=${projectDir}`,
    systemdEnvironment("KOTA_PROJECT_DIR", projectDir),
    ...(nodeOptions ? [systemdEnvironment("NODE_OPTIONS", nodeOptions)] : []),
    `Restart=on-failure`,
    `StandardOutput=journal`,
    `StandardError=journal`,
    ``,
    `[Install]`,
    `WantedBy=default.target`,
  ].join("\n");
}

export function writeServiceFile(path: string, content: string): string | null {
  if (existsSync(path)) {
    return `KOTA daemon service is already installed at ${path}. Run 'kota daemon uninstall' first.`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return null;
}

export function removeServiceFile(path: string): string | null {
  if (!existsSync(path)) {
    return "No KOTA daemon service found. Run 'kota daemon install' first.";
  }
  rmSync(path);
  return null;
}
