import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { line, plain, span } from "./primitives.js";
import { ASCII_THEME, DEFAULT_THEME, NO_COLOR_THEME } from "./theme.js";
import {
  getTerminalTransport,
  printToStderr,
  renderToString,
  setStderrTransport,
  setTerminalTransport,
  startSpinner,
  TerminalScreenSession,
  TerminalTransport,
  type TransportStream,
  writeJson,
  writeStderr,
  writeStdout,
  writeStdoutLine,
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
    setStderrTransport(null);
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

  test("raw machine-output helpers write through the shared stdout transport", () => {
    const stream = bufferStream({ isTTY: false });
    setTerminalTransport(new TerminalTransport({ stream }));
    writeStdout("raw");
    writeStdoutLine("line");
    writeJson({ ok: true });
    expect(stream.chunks.join("")).toBe('rawline\n{"ok":true}\n');
  });

  test("printToStderr writes through the shared stderr transport", () => {
    const stream = bufferStream({ isTTY: false });
    setStderrTransport(new TerminalTransport({ stream }));
    printToStderr(line(span("bad", "error")));
    expect(stream.chunks.join("")).toBe("bad\n");
  });

  test("writeStderr forwards raw chunks through the shared stderr transport", () => {
    const stream = bufferStream({ isTTY: false });
    setStderrTransport(new TerminalTransport({ stream }));
    writeStderr("raw err");
    expect(stream.chunks.join("")).toBe("raw err");
  });
});

describe("startSpinner", () => {
  afterEach(() => {
    vi.useRealTimers();
    setTerminalTransport(null);
  });

  test("emits a single static frame on a non-tty stream", () => {
    const stream = bufferStream({ isTTY: false });
    const transport = new TerminalTransport({ stream });
    const handle = startSpinner("loading", { transport });
    expect(stream.chunks).toHaveLength(1);
    expect(stream.chunks[0]).toContain("loading");
    handle.succeed("done");
    const last = stream.chunks.at(-1)!;
    expect(last).toContain("done");
    expect(last).toContain("✓");
  });

  test("does not emit any redraw chunks between updates on a non-tty stream", () => {
    const stream = bufferStream({ isTTY: false });
    const transport = new TerminalTransport({ stream });
    const handle = startSpinner("loading", { transport });
    handle.update("step 2");
    handle.update("step 3");
    expect(stream.chunks).toHaveLength(1);
    handle.succeed();
    expect(stream.chunks).toHaveLength(2);
    expect(stream.chunks[1]).toContain("step 3");
  });

  test("redraws frames on an interactive tty and finalizes with the success icon", () => {
    vi.useFakeTimers();
    const stream = bufferStream({ isTTY: true, columns: 80 });
    const transport = new TerminalTransport({ stream });
    const handle = startSpinner("loading", { transport, intervalMs: 25 });
    expect(stream.chunks.length).toBe(1);
    expect(stream.chunks[0].startsWith("\r\x1b[2K")).toBe(true);
    expect(stream.chunks[0]).toContain("loading");
    vi.advanceTimersByTime(75);
    expect(stream.chunks.length).toBeGreaterThan(2);
    handle.succeed("done");
    const last = stream.chunks.at(-1)!;
    expect(last.startsWith("\r\x1b[2K")).toBe(true);
    expect(last).toContain("done");
    expect(last.endsWith("\n")).toBe(true);
  });

  test("clears the current spinner line when stopped on an interactive tty", () => {
    vi.useFakeTimers();
    const stream = bufferStream({ isTTY: true, columns: 80 });
    const transport = new TerminalTransport({ stream });
    const handle = startSpinner("loading", { transport, intervalMs: 25 });
    handle.stop();
    expect(stream.chunks.at(-1)).toBe("\r\x1b[2K");
  });
});

describe("TerminalScreenSession", () => {
  test("owns alternate-screen control for interactive streams", () => {
    const stream = bufferStream({ isTTY: true, columns: 80 });
    const screen = new TerminalScreenSession({ stream });
    screen.start();
    screen.writeFrame("hello");
    screen.stop();
    const output = stream.chunks.join("");
    expect(output).toContain("\x1b[?1049h");
    expect(output).toContain("\x1b[?25l");
    expect(output).toContain("hello\n");
    expect(output).toContain("\x1b[?25h");
    expect(output).toContain("\x1b[?1049l");
  });

  test("skips alternate-screen control for non-tty streams", () => {
    const stream = bufferStream({ isTTY: false });
    const screen = new TerminalScreenSession({ stream });
    screen.start();
    screen.writeFrame("hello");
    screen.stop();
    expect(stream.chunks.join("")).toBe("hello\n");
  });
});
