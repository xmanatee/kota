import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cross-module integration tests: init.ts → loop.ts (AgentSession) → context.ts → system-prompt.ts
// Verifies environment/project detection flows through session startup into the system prompt.

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

vi.mock("./mcp/manager.js", () => ({
  McpManager: { loadConfig: () => null },
}));

// Suppress console.error during tests
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("init → loop → context: session startup pipeline", () => {
  it("system prompt includes SYSTEM_PROMPT base content", async () => {
    const { AgentSession } = await import("./loop.js");
    const { SYSTEM_PROMPT } = await import("./system-prompt.js");

    const session = new AgentSession();
    // Access the static prompt through the public close path — verify via context
    // The system prompt must start with SYSTEM_PROMPT
    // We test indirectly: the context stores the combined prompt
    const ctx = (session as any).context;
    const staticPrompt: string = ctx.getStaticPrompt();
    expect(staticPrompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    session.close();
  });

  it("warmup section appears in the static prompt", async () => {
    const { AgentSession } = await import("./loop.js");

    const session = new AgentSession();
    const staticPrompt: string = (session as any).context.getStaticPrompt();
    // buildSessionWarmup always includes working directory
    expect(staticPrompt).toContain("**Working directory**:");
    expect(staticPrompt).toContain("## Session Context (auto-detected)");
    session.close();
  });

  it("system info (date, platform) appears in static prompt", async () => {
    const { AgentSession } = await import("./loop.js");

    const session = new AgentSession();
    const staticPrompt: string = (session as any).context.getStaticPrompt();
    expect(staticPrompt).toContain("**System**:");
    expect(staticPrompt).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(staticPrompt).toMatch(/Platform: (macOS|Linux|Windows)/);
    session.close();
  });

  it("project detection flows into static prompt for code directories", async () => {
    // Current directory is a Node.js project (has package.json)
    const { AgentSession } = await import("./loop.js");

    const session = new AgentSession();
    const staticPrompt: string = (session as any).context.getStaticPrompt();
    expect(staticPrompt).toContain("**Project**:");
    expect(staticPrompt).toContain("Node.js project");
    session.close();
  });
});

describe("init → loop: environment detection for non-code workspaces (cross-module)", () => {
  it("detectEnvironment output appears in warmup when no project detected", async () => {
    const { buildSessionWarmup } = await import("./init.js");
    const { detectEnvironment } = await import("./project-detection.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    // Create a temp dir with data files (no project files)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-env-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "sales.csv"), "product,revenue\nA,100");
      fs.writeFileSync(path.join(tmpDir, "notes.txt"), "Some notes");
      fs.writeFileSync(path.join(tmpDir, "logo.png"), "fake-png");

      // detectEnvironment should find data + documents + images
      const env = detectEnvironment(tmpDir);
      expect(env).toContain("data file");
      expect(env).toContain("document");
      expect(env).toContain("image");

      // buildSessionWarmup should include **Environment** (not **Project**)
      const warmup = buildSessionWarmup(tmpDir);
      expect(warmup).toContain("**Environment**:");
      expect(warmup).not.toContain("**Project**:");
      expect(warmup).toContain("data");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("warmup format produces valid system prompt when concatenated", async () => {
    const { buildSessionWarmup } = await import("./init.js");
    const { SYSTEM_PROMPT } = await import("./system-prompt.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-concat-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "data.json"), "{}");

      const warmup = buildSessionWarmup(tmpDir);
      const combined = SYSTEM_PROMPT + warmup;

      // Combined prompt should not have doubled section headers
      const sessionHeaders = combined.match(/## Session Context/g);
      expect(sessionHeaders?.length || 0).toBeLessThanOrEqual(1);

      // Warmup should start with newlines for clean separation
      expect(warmup).toMatch(/^\n\n/);

      // Combined should end cleanly (no trailing garbage)
      expect(combined.trim().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("project detection takes priority over environment detection in warmup", async () => {
    const { buildSessionWarmup } = await import("./init.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kota-prio-test-"));
    try {
      // Dir has both a project file AND data files
      fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}');
      fs.writeFileSync(path.join(tmpDir, "data.csv"), "a,b\n1,2");

      const warmup = buildSessionWarmup(tmpDir);
      // Project should win, Environment should not appear
      expect(warmup).toContain("**Project**:");
      expect(warmup).not.toContain("**Environment**:");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("system prompt workflow guidance coverage", () => {
  it("system prompt includes non-code workflow patterns", async () => {
    const { SYSTEM_PROMPT } = await import("./system-prompt.js");

    // These workflow sections are critical for general-purpose use
    expect(SYSTEM_PROMPT).toContain("### Research & Investigation");
    expect(SYSTEM_PROMPT).toContain("### Data Analysis");
    expect(SYSTEM_PROMPT).toContain("### Writing & Composition");
    expect(SYSTEM_PROMPT).toContain("### Planning & Strategy");
    expect(SYSTEM_PROMPT).toContain("### Everyday Assistance");
    expect(SYSTEM_PROMPT).toContain("### Automation & Monitoring");
    expect(SYSTEM_PROMPT).toContain("### Debugging & Diagnosis");
  });

  it("system prompt references key tools for non-code tasks", async () => {
    const { SYSTEM_PROMPT } = await import("./system-prompt.js");

    // Data analysis tools
    expect(SYSTEM_PROMPT).toContain("matplotlib");
    expect(SYSTEM_PROMPT).toContain("code_exec");
    // Research tools
    expect(SYSTEM_PROMPT).toContain("web_search");
    expect(SYSTEM_PROMPT).toContain("web_fetch");
    // Writing tools
    expect(SYSTEM_PROMPT).toContain("file_write");
    // Delegation for large tasks
    expect(SYSTEM_PROMPT).toContain("delegate");
  });
});
