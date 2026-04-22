import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { line, plain, span } from "./primitives.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "./theme.js";
import {
  getTerminalTransport,
  renderToString,
  setTerminalTransport,
  TerminalTransport,
  type TransportStream,
} from "./transport.js";

function bufferStream(opts: { isTTY: boolean; columns?: number }): TransportStream & { chunks: string[] } {
  const chunks: string[] = [];
  const stream: TransportStream & { chunks: string[] } = {
    chunks,
    isTTY: opts.isTTY,
    ...(opts.columns !== undefined && { columns: opts.columns }),
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  };
  return stream;
}

describe("TerminalTransport", () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalRendererTheme = process.env.KOTA_RENDERER_THEME;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.KOTA_RENDERER_THEME;
  });

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
    if (originalRendererTheme === undefined) delete process.env.KOTA_RENDERER_THEME;
    else process.env.KOTA_RENDERER_THEME = originalRendererTheme;
    setTerminalTransport(null);
  });

  test("picks the default theme and declared columns on a real tty", () => {
    const stream = bufferStream({ isTTY: true, columns: 40 });
    const transport = new TerminalTransport({ stream });
    const ctx = transport.context();
    expect(ctx.theme).toBe(DEFAULT_THEME);
    expect(ctx.width).toBe(40);
  });

  test("picks the no-color theme on a non-tty stream", () => {
    const stream = bufferStream({ isTTY: false });
    const transport = new TerminalTransport({ stream });
    const ctx = transport.context();
    expect(ctx.theme).toBe(NO_COLOR_THEME);
    expect(ctx.width).toBeGreaterThan(0);
  });

  test("honors NO_COLOR even on a tty", () => {
    process.env.NO_COLOR = "1";
    const stream = bufferStream({ isTTY: true, columns: 80 });
    const transport = new TerminalTransport({ stream });
    expect(transport.context().theme).toBe(NO_COLOR_THEME);
  });

  test("honors KOTA_RENDERER_THEME=ascii", () => {
    process.env.KOTA_RENDERER_THEME = "ascii";
    const stream = bufferStream({ isTTY: true, columns: 80 });
    const transport = new TerminalTransport({ stream });
    expect(transport.context().theme).toBe(ASCII_THEME);
  });

  test("write appends a trailing newline to rendered output", () => {
    const stream = bufferStream({ isTTY: false });
    const transport = new TerminalTransport({ stream });
    transport.write(line(plain("hi")));
    expect(stream.chunks.join("")).toBe("hi\n");
  });

  test("ansi span stays intact on tty, stripped on pipe", () => {
    const tty = bufferStream({ isTTY: true, columns: 40 });
    const pipe = bufferStream({ isTTY: false });
    new TerminalTransport({ stream: tty }).write(line(span("ok", "success")));
    new TerminalTransport({ stream: pipe }).write(line(span("ok", "success")));
    expect(tty.chunks.join("")).toContain("[32m");
    expect(pipe.chunks.join("")).not.toContain("[");
  });

  test("getTerminalTransport returns a memoized shared instance", () => {
    const first = getTerminalTransport();
    const second = getTerminalTransport();
    expect(first).toBe(second);
    setTerminalTransport(null);
    const third = getTerminalTransport();
    expect(third).not.toBe(first);
  });

  test("renderToString uses the shared transport context by default", () => {
    const stream = bufferStream({ isTTY: false });
    setTerminalTransport(new TerminalTransport({ stream }));
    const rendered = renderToString(line(span("ok", "success")));
    expect(rendered).toBe("ok");
  });
});
