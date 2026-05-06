/**
 * Layout helpers for the rendering module's wider primitives.
 *
 * The pure renderer in `render.ts` stays focused on dispatch and
 * span painting; column-fitting, prose word-wrapping, and frame
 * computation for spinners/progress live here so `primitives.ts`
 * does not smuggle large helpers into the type file and so the
 * helpers can be unit-tested directly.
 *
 * Every helper is pure: same inputs always yield the same output.
 * Animation lives in the transport, not in render-tree primitives.
 */

import type { ColumnSpec, TextSpan } from "./primitives.js";

const SAFE_MIN_COLUMN = 3;

export function spansVisibleLength(spans: TextSpan[]): number {
  return spans.reduce((acc, s) => acc + s.text.length, 0);
}

/**
 * Distribute available width across column specs. Each column gets at
 * least its observed natural width clamped to the spec bounds, then
 * leftover width is shared proportionally among columns whose spec
 * does not pin them with a `maxWidth`. Columns whose `maxWidth` would
 * truncate are honored, and the renderer handles the actual truncate
 * when it paints the row.
 */
export function distributeColumnWidths(
  specs: ColumnSpec[],
  natural: number[],
  available: number,
): number[] {
  const count = specs.length;
  if (count === 0) return [];

  const COLUMN_GAP = 2;
  const gaps = COLUMN_GAP * (count - 1);
  const usable = Math.max(SAFE_MIN_COLUMN * count, available - gaps);

  const widths: number[] = [];
  for (let i = 0; i < count; i++) {
    const spec = specs[i]!;
    const natWidth = natural[i] ?? 0;
    const min = spec.minWidth ?? Math.min(natWidth, SAFE_MIN_COLUMN);
    const max = spec.maxWidth ?? natWidth;
    widths.push(Math.max(min, Math.min(max, natWidth)));
  }

  const allocated = widths.reduce((a, w) => a + w, 0);
  if (allocated <= usable) {
    let remaining = usable - allocated;
    const flexible: number[] = [];
    for (let i = 0; i < count; i++) {
      if (specs[i]!.maxWidth === undefined) flexible.push(i);
    }
    if (flexible.length > 0 && remaining > 0) {
      const each = Math.floor(remaining / flexible.length);
      for (const idx of flexible) {
        widths[idx] = widths[idx]! + each;
        remaining -= each;
      }
      let i = 0;
      while (remaining > 0 && i < flexible.length) {
        widths[flexible[i]!] = widths[flexible[i]!]! + 1;
        remaining -= 1;
        i += 1;
      }
    }
    return widths;
  }

  let overflow = allocated - usable;
  const order = widths
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w)
    .map((e) => e.i);
  let cursor = 0;
  while (overflow > 0) {
    const idx = order[cursor % order.length]!;
    if (widths[idx]! > SAFE_MIN_COLUMN) {
      widths[idx] = widths[idx]! - 1;
      overflow -= 1;
    } else if (order.every((i) => widths[i]! <= SAFE_MIN_COLUMN)) {
      break;
    }
    cursor += 1;
  }
  return widths;
}

/**
 * Pad or truncate cell text to a target visible width, honoring
 * alignment. Works on plain text; the caller paints any role-
 * coloring after measurement so ANSI codes do not skew widths.
 */
export function fitCellText(
  text: string,
  width: number,
  align: "left" | "right",
): string {
  if (text.length === width) return text;
  if (text.length > width) {
    if (width <= 1) return text.slice(0, width);
    return `${text.slice(0, Math.max(0, width - 1))}…`;
  }
  const pad = " ".repeat(width - text.length);
  return align === "right" ? `${pad}${text}` : `${text}${pad}`;
}

/**
 * Word-wrap a paragraph into lines that fit `width`. Whitespace runs
 * collapse to a single space; words longer than `width` break on
 * character boundaries so a long URL still renders.
 */
export function wrapProse(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const paragraphs = text.split(/\n\n+/);
  const out: string[] = [];
  paragraphs.forEach((paragraph, idx) => {
    if (idx > 0) out.push("");
    const lines = paragraph.split("\n");
    for (const ln of lines) {
      const words = ln.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let current = "";
      for (const word of words) {
        if (word.length > safeWidth) {
          if (current) {
            out.push(current);
            current = "";
          }
          let remaining = word;
          while (remaining.length > safeWidth) {
            out.push(remaining.slice(0, safeWidth));
            remaining = remaining.slice(safeWidth);
          }
          current = remaining;
          continue;
        }
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= safeWidth) {
          current = candidate;
        } else {
          out.push(current);
          current = word;
        }
      }
      if (current) out.push(current);
    }
  });
  return out;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_SPINNER_FRAMES = ["|", "/", "-", "\\"];

export function spinnerFrame(theme: "default" | "ascii" | "no-color", tick: number): string {
  const frames = theme === "ascii" || theme === "no-color" ? ASCII_SPINNER_FRAMES : SPINNER_FRAMES;
  const idx = ((tick % frames.length) + frames.length) % frames.length;
  return frames[idx]!;
}

export function spinnerStaticGlyph(theme: "default" | "ascii" | "no-color"): string {
  return theme === "ascii" || theme === "no-color" ? "..." : "⋯";
}

const PROGRESS_BAR_FILLED = "█";
const PROGRESS_BAR_EMPTY = "░";
const ASCII_PROGRESS_FILLED = "#";
const ASCII_PROGRESS_EMPTY = "-";

export function progressBar(
  current: number,
  total: number,
  width: number,
  theme: "default" | "ascii" | "no-color",
): string {
  const safeWidth = Math.max(1, width);
  const safeTotal = total <= 0 ? 1 : total;
  const ratio = Math.min(1, Math.max(0, current / safeTotal));
  const filled = Math.round(ratio * safeWidth);
  const empty = safeWidth - filled;
  const filledGlyph = theme === "ascii" || theme === "no-color" ? ASCII_PROGRESS_FILLED : PROGRESS_BAR_FILLED;
  const emptyGlyph = theme === "ascii" || theme === "no-color" ? ASCII_PROGRESS_EMPTY : PROGRESS_BAR_EMPTY;
  return `${filledGlyph.repeat(filled)}${emptyGlyph.repeat(empty)}`;
}
