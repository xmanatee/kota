import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonLogger } from "./daemon-logger.js";

describe("DaemonLogger — text format", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("info emits a plain line with [kota-daemon] prefix", () => {
    const logger = new DaemonLogger("text");
    logger.info("Daemon starting...");
    expect(written).toHaveLength(1);
    expect(written[0]).toBe("[kota-daemon] Daemon starting...\n");
  });

  it("warn emits WARN prefix", () => {
    const logger = new DaemonLogger("text");
    logger.warn("something odd");
    expect(written[0]).toBe("[kota-daemon] WARN: something odd\n");
  });

  it("error emits ERROR prefix", () => {
    const logger = new DaemonLogger("text");
    logger.error("boom");
    expect(written[0]).toBe("[kota-daemon] ERROR: boom\n");
  });

  it("line() emits info-level text", () => {
    const logger = new DaemonLogger("text");
    logger.line("raw message");
    expect(written[0]).toBe("[kota-daemon] raw message\n");
  });
});

describe("DaemonLogger — json format", () => {
  let written: string[];

  beforeEach(() => {
    written = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function parseFirst(): Record<string, unknown> {
    expect(written).toHaveLength(1);
    return JSON.parse(written[0]!.trimEnd()) as Record<string, unknown>;
  }

  it("produces parseable NDJSON", () => {
    const logger = new DaemonLogger("json");
    logger.info("hello");
    expect(() => JSON.parse(written[0]!.trimEnd())).not.toThrow();
  });

  it("includes ts, level, msg fields", () => {
    const logger = new DaemonLogger("json");
    logger.info("Daemon starting...");
    const parsed = parseFirst();
    expect(typeof parsed.ts).toBe("string");
    expect(new Date(parsed.ts as string).toISOString()).toBe(parsed.ts);
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("Daemon starting...");
  });

  it("includes contextual fields when provided", () => {
    const logger = new DaemonLogger("json");
    logger.info("workflow started", { workflow: "builder", runId: "run-abc" });
    const parsed = parseFirst();
    expect(parsed.workflow).toBe("builder");
    expect(parsed.runId).toBe("run-abc");
  });

  it("warn level is reflected in JSON", () => {
    const logger = new DaemonLogger("json");
    logger.warn("something odd", { event: "startup" });
    const parsed = parseFirst();
    expect(parsed.level).toBe("warn");
    expect(parsed.event).toBe("startup");
  });

  it("error level is reflected in JSON", () => {
    const logger = new DaemonLogger("json");
    logger.error("fatal", { module: "my-ext" });
    const parsed = parseFirst();
    expect(parsed.level).toBe("error");
    expect(parsed.module).toBe("my-ext");
  });

  it("omits undefined contextual fields", () => {
    const logger = new DaemonLogger("json");
    logger.info("no fields");
    const parsed = parseFirst();
    expect(parsed.workflow).toBeUndefined();
    expect(parsed.runId).toBeUndefined();
  });

  it("line() emits info-level JSON", () => {
    const logger = new DaemonLogger("json");
    logger.line("raw line");
    const parsed = parseFirst();
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("raw line");
  });
});

describe("DaemonLogger — KOTA_DAEMON_LOG_FORMAT env var", () => {
  let written: string[];
  const original = process.env.KOTA_DAEMON_LOG_FORMAT;

  beforeEach(() => {
    written = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    delete process.env.KOTA_DAEMON_LOG_FORMAT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) {
      delete process.env.KOTA_DAEMON_LOG_FORMAT;
    } else {
      process.env.KOTA_DAEMON_LOG_FORMAT = original;
    }
  });

  it("defaults to text when env var is unset", () => {
    const logger = new DaemonLogger();
    logger.info("msg");
    expect(written[0]).toBe("[kota-daemon] msg\n");
  });

  it("uses json when KOTA_DAEMON_LOG_FORMAT=json", () => {
    process.env.KOTA_DAEMON_LOG_FORMAT = "json";
    const logger = new DaemonLogger();
    logger.info("msg");
    const parsed = JSON.parse(written[0]!.trimEnd()) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
  });

  it("explicit format overrides env var", () => {
    process.env.KOTA_DAEMON_LOG_FORMAT = "json";
    const logger = new DaemonLogger("text");
    logger.info("msg");
    expect(written[0]).toBe("[kota-daemon] msg\n");
  });
});
