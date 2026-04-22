import type { SemanticRole, StatusKind } from "./primitives.js";

/**
 * Theme maps semantic roles to ANSI SGR codes. Non-interactive transports
 * resolve to the `no-color` theme; no call site branches on NO_COLOR or
 * terminal capability directly.
 */

export type Ansi = {
  open: string;
  close: string;
};

export const RESET = "[0m";

function sgr(open: string): Ansi {
  return { open: `[${open}m`, close: RESET };
}

export type Theme = {
  name: string;
  supportsAnsi: boolean;
  role: Record<SemanticRole, Ansi>;
  status: Record<StatusKind, { ansi: Ansi; icon: string; label: string }>;
  bold: Ansi;
  headingRule: string;
  separatorRule: string;
};

const emptyAnsi: Ansi = { open: "", close: "" };

const DEFAULT_ROLES: Record<SemanticRole, Ansi> = {
  neutral: emptyAnsi,
  info: sgr("36"),
  success: sgr("32"),
  warn: sgr("33"),
  error: sgr("31"),
  muted: sgr("2"),
  accent: sgr("35"),
  tool: sgr("34"),
  agent: sgr("36;1"),
};

const NO_COLOR_ROLES: Record<SemanticRole, Ansi> = Object.fromEntries(
  (Object.keys(DEFAULT_ROLES) as SemanticRole[]).map((role) => [role, emptyAnsi]),
) as Record<SemanticRole, Ansi>;

const STATUS_ICONS_UNICODE: Record<StatusKind, string> = {
  success: "✓",
  error: "✗",
  warn: "⚠",
  info: "ℹ",
  pending: "⋯",
};

const STATUS_ICONS_ASCII: Record<StatusKind, string> = {
  success: "v",
  error: "x",
  warn: "!",
  info: "i",
  pending: "...",
};

const STATUS_LABELS: Record<StatusKind, string> = {
  success: "OK",
  error: "FAIL",
  warn: "WARN",
  info: "INFO",
  pending: "...",
};

const STATUS_ANSI: Record<StatusKind, Ansi> = {
  success: DEFAULT_ROLES.success,
  error: DEFAULT_ROLES.error,
  warn: DEFAULT_ROLES.warn,
  info: DEFAULT_ROLES.info,
  pending: DEFAULT_ROLES.muted,
};

function buildStatus(ansi: Record<StatusKind, Ansi>, icons: Record<StatusKind, string>) {
  return Object.fromEntries(
    (Object.keys(ansi) as StatusKind[]).map((k) => [
      k,
      { ansi: ansi[k], icon: icons[k], label: STATUS_LABELS[k] },
    ]),
  ) as Theme["status"];
}

export const DEFAULT_THEME: Theme = {
  name: "default",
  supportsAnsi: true,
  role: DEFAULT_ROLES,
  status: buildStatus(STATUS_ANSI, STATUS_ICONS_UNICODE),
  bold: sgr("1"),
  headingRule: "─",
  separatorRule: "─",
};

export const NO_COLOR_THEME: Theme = {
  name: "no-color",
  supportsAnsi: false,
  role: NO_COLOR_ROLES,
  status: buildStatus(
    Object.fromEntries(
      (Object.keys(STATUS_ANSI) as StatusKind[]).map((k) => [k, emptyAnsi]),
    ) as Record<StatusKind, Ansi>,
    STATUS_ICONS_UNICODE,
  ),
  bold: emptyAnsi,
  headingRule: "-",
  separatorRule: "-",
};

export const ASCII_THEME: Theme = {
  ...NO_COLOR_THEME,
  name: "ascii",
  status: buildStatus(
    Object.fromEntries(
      (Object.keys(STATUS_ANSI) as StatusKind[]).map((k) => [k, emptyAnsi]),
    ) as Record<StatusKind, Ansi>,
    STATUS_ICONS_ASCII,
  ),
};
