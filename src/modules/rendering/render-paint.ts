/**
 * Shared paint helpers used by every render-handler file. Keeping the
 * paint primitives in one place lets the handler files in this module
 * stay focused on per-node layout and avoids each one re-deriving the
 * indent / span paint conventions.
 */

import type { SemanticRole, StatusKind, TextSpan } from "./primitives.js";
import { DEFAULT_THEME, type Theme } from "./theme.js";

export type RenderContext = {
  theme: Theme;
  width: number;
  indent: number;
};

const MIN_WIDTH = 20;

export function renderContext(partial?: Partial<RenderContext>): RenderContext {
  return {
    theme: partial?.theme ?? DEFAULT_THEME,
    width: Math.max(MIN_WIDTH, partial?.width ?? 80),
    indent: partial?.indent ?? 0,
  };
}

export function pad(n: number): string {
  return n > 0 ? " ".repeat(n) : "";
}

export function paintSpan(span: TextSpan, theme: Theme): string {
  if (!theme.supportsAnsi) return span.text;
  const roleAnsi = span.role ? theme.role[span.role] : undefined;
  const bold = span.bold ? theme.bold : undefined;
  const opens = `${bold?.open ?? ""}${roleAnsi?.open ?? ""}`;
  if (!opens) return span.text;
  return `${opens}${span.text}\x1b[0m`;
}

export function paintSpans(spans: TextSpan[], theme: Theme): string {
  return spans.map((s) => paintSpan(s, theme)).join("");
}

export function statusRole(status: StatusKind): SemanticRole {
  switch (status) {
    case "success":
      return "success";
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "info":
      return "info";
    case "pending":
      return "muted";
  }
}

export function themeName(theme: Theme): "default" | "ascii" | "no-color" {
  if (theme.name === "ascii") return "ascii";
  if (theme.name === "no-color") return "no-color";
  return "default";
}
