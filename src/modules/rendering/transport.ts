import type { WriteStream } from "node:tty";
import type { RenderNode } from "./primitives.js";
import { type RenderContext, render, renderContext } from "./render.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME, type Theme } from "./theme.js";

/**
 * Terminal transport wraps stdout/stderr, picks the right theme and
 * width for the current TTY, and writes rendered strings. Non-TTY
 * callers get the no-color theme and a machine-parseable fallback
 * width, so piped output, CI logs, and JSON-stream consumers are not
 * corrupted by ANSI escapes.
 */

export type TransportStream = {
  write(chunk: string): boolean;
  columns?: number;
  isTTY?: boolean;
};

export type TransportOptions = {
  stream?: TransportStream;
  theme?: Theme;
  width?: number;
};

const FALLBACK_WIDTH = 100;

function detectTheme(stream: TransportStream): Theme {
  if (process.env.NO_COLOR) return NO_COLOR_THEME;
  if (process.env.KOTA_RENDERER_THEME === "ascii") return ASCII_THEME;
  if (process.env.KOTA_RENDERER_THEME === "no-color") return NO_COLOR_THEME;
  if (stream.isTTY) return DEFAULT_THEME;
  return NO_COLOR_THEME;
}

function detectWidth(stream: TransportStream): number {
  if (stream.columns && stream.columns > 0) return stream.columns;
  if (process.stdout.columns && process.stdout.columns > 0) return process.stdout.columns;
  return FALLBACK_WIDTH;
}

function asTransportStream(stream: WriteStream | TransportStream): TransportStream {
  return stream as TransportStream;
}

export class TerminalTransport {
  private readonly stream: TransportStream;
  private readonly themeOverride: Theme | undefined;
  private readonly widthOverride: number | undefined;

  constructor(opts: TransportOptions = {}) {
    this.stream = opts.stream ?? asTransportStream(process.stdout);
    this.themeOverride = opts.theme;
    this.widthOverride = opts.width;
  }

  context(): RenderContext {
    const partial: Partial<RenderContext> = {
      theme: this.themeOverride ?? detectTheme(this.stream),
      width: this.widthOverride ?? detectWidth(this.stream),
    };
    return renderContext(partial);
  }

  write(node: RenderNode): void {
    const rendered = render(node, this.context());
    this.stream.write(`${rendered}\n`);
  }

  writeRaw(text: string): void {
    this.stream.write(text);
  }
}

/**
 * Shared transport used by default terminal surfaces. Holding a single
 * instance keeps theme/width detection consistent within one process
 * without forcing every call site to pass a transport through.
 */
let defaultTransport: TerminalTransport | null = null;

export function getTerminalTransport(): TerminalTransport {
  if (!defaultTransport) defaultTransport = new TerminalTransport();
  return defaultTransport;
}

export function setTerminalTransport(transport: TerminalTransport | null): void {
  defaultTransport = transport;
}

/**
 * Convenience print: render a node and write the result to the shared
 * transport. Surfaces that need custom streams (stderr, buffered
 * writers) construct their own transport instead.
 */
export function print(node: RenderNode): void {
  getTerminalTransport().write(node);
}

/**
 * Render a node to a string using a supplied context or the shared
 * transport's current context. Useful for tests and for feeding
 * structured output into existing string-consumer code paths.
 */
export function renderToString(node: RenderNode, ctx?: Partial<RenderContext>): string {
  if (ctx) return render(node, ctx);
  return render(node, getTerminalTransport().context());
}
